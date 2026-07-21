import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';
import { parseFile, ParsedFile } from './parser.js';
import { indexSource } from './indexer.js';
import { BiDirectionalGraph } from './graph.js';
import { resolveEntries } from './resolver.js';
import { DeadCodeReport, NodeType, Confidence, FileAnalysisReport, SymbolAnalysisReport, Node, Edge, FileIndex } from './types.js';

export interface AnalyzerOptions {
  projectPath: string;
  entryPatterns?: string[];
  excludePatterns?: string[];
}

export class DeadCodeAnalyzer {
  private projectPath: string;
  private entryPatterns?: string[];
  private excludePatterns: string[];
  public graph: BiDirectionalGraph = new BiDirectionalGraph();

  constructor(options: AnalyzerOptions) {
    this.projectPath = path.resolve(options.projectPath);
    this.entryPatterns = options.entryPatterns;
    this.excludePatterns = options.excludePatterns || [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/coverage/**'
    ];
  }

  analyze(): DeadCodeReport {
    // 1. Resolve Entry Points
    const entries = resolveEntries(this.projectPath, this.entryPatterns);
    
    // 2. Find all source files
    const filePatterns = ['**/*.vue', '**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx'];
    const allFiles = fg.sync(filePatterns, {
      cwd: this.projectPath,
      absolute: true,
      ignore: this.excludePatterns
    });

    const parsedFiles = new Map<string, ParsedFile>();
    const fileIndexes = new Map<string, FileIndex>();
    this.graph = new BiDirectionalGraph();
    const graph = this.graph;

    // Parse and Index all files
    for (const filePath of allFiles) {
      try {
        const parsed = parseFile(filePath);
        parsedFiles.set(filePath, parsed);

        const indexed = indexSource(filePath, parsed.scriptContent, parsed.templateTags);
        fileIndexes.set(filePath, indexed);

        // Add File node to graph
        const fileNodeId = `file:///${filePath.replace(/\\/g, '/')}`;
        const isEntry = entries.includes(filePath);
        graph.addNode({
          id: fileNodeId,
          type: NodeType.FILE,
          path: filePath,
          isEntry
        });

        // Add Symbol nodes for local exports
        for (const exp of indexed.exports) {
          if (exp.name !== '*' && !exp.isReExport) {
            const symNodeId = `${fileNodeId}#${exp.name}`;
            graph.addNode({
              id: symNodeId,
              type: NodeType.SYMBOL,
              path: filePath,
              symbolName: exp.name,
              isEntry: false
            });
          }
        }
      } catch (err) {
        // Failed to parse/index file, skip or log
      }
    }

    // Check if any file has dynamic components
    let hasGlobalDynamicComponents = false;
    for (const parsed of parsedFiles.values()) {
      if (parsed.hasDynamicComponents) {
        hasGlobalDynamicComponents = true;
        break;
      }
    }

    // 3. Construct Edges
    for (const filePath of allFiles) {
      const parsed = parsedFiles.get(filePath);
      const indexed = fileIndexes.get(filePath);
      if (!parsed || !indexed) continue;

      const fileNodeId = `file:///${filePath.replace(/\\/g, '/')}`;

      // A) Parent link edges: exported symbol -> parent file
      // B) File level reference edges: parent file -> referenced symbol
      for (const exp of indexed.exports) {
        if (exp.name !== '*' && !exp.isReExport) {
          const symNodeId = `${fileNodeId}#${exp.name}`;
          graph.addEdge({
            from: symNodeId,
            to: fileNodeId,
            confidence: Confidence.HIGH,
            type: 'IMPORT' // or parent link
          });
        }
      }

      for (const ref of indexed.fileLevelReferences) {
        const toSymbolNodeId = `${fileNodeId}#${ref}`;
        graph.addEdge({
          from: fileNodeId,
          to: toSymbolNodeId,
          confidence: Confidence.HIGH,
          type: 'IMPORT'
        });
      }

      // C) Local references: fromSymbol -> toSymbol
      for (const ref of indexed.localReferences) {
        const fromNodeId = `${fileNodeId}#${ref.fromSymbol}`;
        const toNodeId = `${fileNodeId}#${ref.toSymbol}`;
        graph.addEdge({
          from: fromNodeId,
          to: toNodeId,
          confidence: Confidence.HIGH,
          type: 'IMPORT'
        });
      }

      // D) Imports: local imported symbol name -> target exported symbol
      for (const imp of indexed.imports) {
        const targetPath = this.resolveModulePath(filePath, imp.moduleSpecifier);
        if (targetPath && fileIndexes.has(targetPath)) {
          const targetFileNodeId = `file:///${targetPath.replace(/\\/g, '/')}`;

          for (const sym of imp.importedSymbols) {
            const localSymNodeId = `${fileNodeId}#${sym.localName}`;
            
            if (sym.isNamespace) {
              // Namespace import: link namespace symbol to the target file itself
              graph.addEdge({
                from: localSymNodeId,
                to: targetFileNodeId,
                confidence: Confidence.MEDIUM,
                type: 'IMPORT'
              });
              // Also link namespace symbol to all exports of the target file
              const targetIndex = fileIndexes.get(targetPath);
              if (targetIndex) {
                for (const targetExp of targetIndex.exports) {
                  if (targetExp.name !== '*') {
                    graph.addEdge({
                      from: localSymNodeId,
                      to: `${targetFileNodeId}#${targetExp.name}`,
                      confidence: Confidence.MEDIUM,
                      type: 'IMPORT'
                    });
                  }
                }
              }
            } else if (sym.isDefault) {
              // Default import: link to default export of target file
              graph.addEdge({
                from: localSymNodeId,
                to: `${targetFileNodeId}#default`,
                confidence: Confidence.HIGH,
                type: 'IMPORT'
              });
            } else {
              // Named import
              const sourceName = sym.propertyName ?? sym.localName;
              graph.addEdge({
                from: localSymNodeId,
                to: `${targetFileNodeId}#${sourceName}`,
                confidence: Confidence.HIGH,
                type: 'IMPORT'
              });
            }
          }
        }
      }

      // E) Re-exports: export { x } from 'y'
      for (const exp of indexed.exports) {
        if (exp.isReExport && exp.reExportModule) {
          const targetPath = this.resolveModulePath(filePath, exp.reExportModule);
          if (targetPath && fileIndexes.has(targetPath)) {
            const targetFileNodeId = `file:///${targetPath.replace(/\\/g, '/')}`;

            if (exp.name === '*') {
              // Star re-export: copy B's exports to A
              const targetIndex = fileIndexes.get(targetPath);
              if (targetIndex) {
                for (const targetExp of targetIndex.exports) {
                  if (targetExp.name !== '*') {
                    // Link A#targetExp.name -> B#targetExp.name
                    const sourceNodeId = `${fileNodeId}#${targetExp.name}`;
                    const targetNodeId = `${targetFileNodeId}#${targetExp.name}`;
                    graph.addEdge({
                      from: sourceNodeId,
                      to: targetNodeId,
                      confidence: Confidence.MEDIUM,
                      type: 'RE_EXPORT'
                    });
                  }
                }
              }
            } else if (exp.reExportSymbol) {
              // Named re-export
              const sourceNodeId = `${fileNodeId}#${exp.name}`;
              const targetNodeId = `${targetFileNodeId}#${exp.reExportSymbol}`;
              graph.addEdge({
                from: sourceNodeId,
                to: targetNodeId,
                confidence: Confidence.HIGH,
                type: 'RE_EXPORT'
              });
            }
          }
        }
      }
    }

    // F) Handle global dynamic components or resolveComponent
    // If hasGlobalDynamicComponents, we want to add LOW/UNKNOWN confidence edges
    // from the files that contain dynamic components to all component files under "components/"
    if (hasGlobalDynamicComponents) {
      const componentFiles = allFiles.filter(f => {
        const normPath = f.replace(/\\/g, '/');
        return normPath.includes('/components/') && f.endsWith('.vue');
      });

      for (const filePath of allFiles) {
        const parsed = parsedFiles.get(filePath);
        if (parsed?.hasDynamicComponents) {
          const fileNodeId = `file:///${filePath.replace(/\\/g, '/')}`;
          for (const compFile of componentFiles) {
            const compFileNodeId = `file:///${compFile.replace(/\\/g, '/')}`;
            // Add a virtual edge with UNKNOWN confidence
            graph.addEdge({
              from: fileNodeId,
              to: compFileNodeId,
              confidence: Confidence.UNKNOWN,
              type: 'TEMPLATE_REF'
            });
            // Also link to default export of that component file
            graph.addEdge({
              from: fileNodeId,
              to: `${compFileNodeId}#default`,
              confidence: Confidence.UNKNOWN,
              type: 'TEMPLATE_REF'
            });
          }
        }
      }
    }

    // 4. Run Reachability Algorithm
    const reachability = graph.computeReachability();
    const aliveNodeIds = reachability.aliveNodeIds;

    // 5. Generate Report
    const fileReports: FileAnalysisReport[] = [];
    let deadFilesCount = 0;
    let deadSymbolsCount = 0;

    for (const filePath of allFiles) {
      const fileNodeId = `file:///${filePath.replace(/\\/g, '/')}`;
      const isAlive = aliveNodeIds.has(fileNodeId);
      const fileIndex = fileIndexes.get(filePath);

      let status: 'ALIVE' | 'DEAD' | 'UNKNOWN' = isAlive ? 'ALIVE' : 'DEAD';
      let fileConfidence = Confidence.HIGH;

      // Extract trace path
      const rawTrace = reachability.traces.get(fileNodeId);
      const tracePath = rawTrace ? rawTrace.map((t: string) => this.cleanNodeId(t)) : undefined;

      // If the file is alive, check the lowest confidence in the trace path to determine file confidence
      if (isAlive && rawTrace) {
        fileConfidence = this.computePathConfidence(rawTrace, graph);
      }

      // Check if it's dead, but should be UNKNOWN due to dynamic components/resolveComponent
      if (!isAlive) {
        // If the path contains '/components/' and we have global dynamic components, mark UNKNOWN
        const isComponent = filePath.replace(/\\/g, '/').includes('/components/') && filePath.endsWith('.vue');
        if (isComponent && hasGlobalDynamicComponents) {
          status = 'UNKNOWN';
          fileConfidence = Confidence.UNKNOWN;
        } else {
          deadFilesCount++;
        }
      }

      const symbolsReport: SymbolAnalysisReport[] = [];

      if (fileIndex) {
        for (const exp of fileIndex.exports) {
          if (exp.name === '*') continue;
          const symNodeId = `${fileNodeId}#${exp.name}`;
          const isSymAlive = aliveNodeIds.has(symNodeId);

          let symStatus: 'ALIVE' | 'DEAD' = isSymAlive ? 'ALIVE' : 'DEAD';
          let symConfidence = Confidence.HIGH;

          const rawSymTrace = reachability.traces.get(symNodeId);
          if (isSymAlive && rawSymTrace) {
            symConfidence = this.computePathConfidence(rawSymTrace, graph);
          }

          if (!isSymAlive) {
            if (status === 'UNKNOWN') {
              // If the file itself is UNKNOWN status due to dynamic rules, its symbols are also UNKNOWN confidence
              symConfidence = Confidence.UNKNOWN;
            } else {
              deadSymbolsCount++;
            }
          }

          symbolsReport.push({
            name: exp.name,
            kind: exp.kind,
            line: exp.line,
            status: symStatus,
            confidence: symConfidence
          });
        }
      }

      const reasons: string[] = [];
      if (status === 'DEAD') {
        reasons.push('No import statement found in any reachable JavaScript/TypeScript files.');
        if (filePath.endsWith('.vue')) {
          reasons.push('No template reference found in reachable Vue SFCs.');
        }
      }

      fileReports.push({
        path: filePath,
        status,
        confidence: fileConfidence,
        tracePath,
        reasons: status === 'DEAD' ? reasons : undefined,
        symbols: symbolsReport
      });
    }

    return {
      version: '1.0.0',
      engine: '@deadfinder/graph-v3',
      summary: {
        totalFiles: allFiles.length,
        deadFilesCount,
        deadSymbolsCount
      },
      files: fileReports
    };
  }

  private computePathConfidence(pathNodes: string[], graph: BiDirectionalGraph): Confidence {
    let lowest: Confidence = Confidence.HIGH;
    for (let i = 0; i < pathNodes.length - 1; i++) {
      const from = pathNodes[i];
      const to = pathNodes[i + 1];
      const edges = graph.getOutgoingEdges(from);
      const edge = edges.find((e: Edge) => e.to === to);
      if (edge) {
        const conf = edge.confidence;
        if (conf === Confidence.UNKNOWN) {
          return Confidence.UNKNOWN;
        }
        if (conf === Confidence.LOW) {
          lowest = Confidence.LOW;
        }
        if (conf === Confidence.MEDIUM && lowest === Confidence.HIGH) {
          lowest = Confidence.MEDIUM;
        }
      }
    }
    return lowest;
  }

  private cleanNodeId(nodeId: string): string {
    if (nodeId.startsWith('file:///')) {
      return nodeId.slice(8);
    }
    return nodeId;
  }

  private resolveModulePath(currentFilePath: string, importSpecifier: string): string | null {
    let resolved: string | null = null;
    if (!importSpecifier.startsWith('.')) {
      // Handle tsconfig/vite alias '@/' -> 'src/'
      if (importSpecifier.startsWith('@/')) {
        const projectRoot = this.findProjectRoot(currentFilePath);
        const resolvedPath = path.join(projectRoot, 'src', importSpecifier.slice(2));
        resolved = this.checkFileExtensions(resolvedPath);
      }
    } else {
      const currentDir = path.dirname(currentFilePath);
      const absolutePath = path.resolve(currentDir, importSpecifier);
      resolved = this.checkFileExtensions(absolutePath);
    }
    return resolved ? resolved.replace(/\\/g, '/') : null;
  }

  private checkFileExtensions(absolutePath: string): string | null {
    // If the path already has a .js or .jsx extension, try replacing it with .ts/.tsx/.vue
    if (absolutePath.endsWith('.js') || absolutePath.endsWith('.jsx')) {
      const ext = absolutePath.endsWith('.js') ? '.js' : '.jsx';
      const basePath = absolutePath.slice(0, -ext.length);
      const tsExtensions = ['.ts', '.tsx', '.vue'];
      for (const tsExt of tsExtensions) {
        const candidate = basePath + tsExt;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      }
    }

    const extensions = ['.vue', '.ts', '.js', '.tsx', '.jsx', '/index.ts', '/index.js', '/index.vue'];
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      return absolutePath;
    }
    for (const ext of extensions) {
      const candidate = absolutePath + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
    return null;
  }

  private findProjectRoot(currentFilePath: string): string {
    let dir = path.dirname(currentFilePath);
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        return dir;
      }
      dir = path.dirname(dir);
    }
    return this.projectPath;
  }
}
