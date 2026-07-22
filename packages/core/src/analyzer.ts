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
  
  // Caches for incremental analysis
  private parsedFiles = new Map<string, ParsedFile>();
  private fileIndexes = new Map<string, FileIndex>();
  private entries: string[] = [];
  private allFiles: string[] = [];

  constructor(options: AnalyzerOptions) {
    this.projectPath = path.resolve(options.projectPath).replace(/\\/g, '/');
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
    this.entries = resolveEntries(this.projectPath, this.entryPatterns);
    
    // 2. Find all source files
    const filePatterns = ['**/*.vue', '**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx'];
    this.allFiles = fg.sync(filePatterns, {
      cwd: this.projectPath,
      absolute: true,
      ignore: this.excludePatterns
    }).map(f => f.replace(/\\/g, '/'));

    // Clear caches
    this.parsedFiles.clear();
    this.fileIndexes.clear();

    // Parse and Index all files
    for (const filePath of this.allFiles) {
      try {
        const parsed = parseFile(filePath);
        this.parsedFiles.set(filePath, parsed);

        const indexed = indexSource(filePath, parsed.scriptContent, parsed.templateTags);
        indexed.declaredSlots = parsed.declaredSlots;
        indexed.childUsages = parsed.childUsages;
        this.fileIndexes.set(filePath, indexed);
      } catch (err) {
        // Failed to parse/index file, skip or log
      }
    }

    this.buildGraph();
    return this.generateReport();
  }

  updateFile(filePath: string): DeadCodeReport {
    const normalizedPath = filePath.replace(/\\/g, '/');

    try {
      if (fs.existsSync(normalizedPath) && fs.statSync(normalizedPath).isFile()) {
        // Re-parse and re-index only the changed file
        const parsed = parseFile(normalizedPath);
        this.parsedFiles.set(normalizedPath, parsed);

        const indexed = indexSource(normalizedPath, parsed.scriptContent, parsed.templateTags);
        indexed.declaredSlots = parsed.declaredSlots;
        indexed.childUsages = parsed.childUsages;
        this.fileIndexes.set(normalizedPath, indexed);

        if (!this.allFiles.includes(normalizedPath)) {
          this.allFiles.push(normalizedPath);
        }
      } else {
        // File was deleted
        this.parsedFiles.delete(normalizedPath);
        this.fileIndexes.delete(normalizedPath);
        this.allFiles = this.allFiles.filter(f => f !== normalizedPath);
      }
    } catch (err) {
      // Graceful fallback if file read/parse fails
      this.parsedFiles.delete(normalizedPath);
      this.fileIndexes.delete(normalizedPath);
      this.allFiles = this.allFiles.filter(f => f !== normalizedPath);
    }

    // Re-resolve entries dynamically if configuration or entries might have changed
    this.entries = resolveEntries(this.projectPath, this.entryPatterns);

    this.buildGraph();
    return this.generateReport();
  }

  private buildGraph(): void {
    this.graph = new BiDirectionalGraph();
    const graph = this.graph;

    // Add nodes
    for (const filePath of this.allFiles) {
      const isEntry = this.entries.includes(filePath);
      const fileNodeId = `file:///${filePath}`;
      
      graph.addNode({
        id: fileNodeId,
        type: NodeType.FILE,
        path: filePath,
        isEntry
      });

      const indexed = this.fileIndexes.get(filePath);
      if (indexed) {
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
      }
    }

    // Check if any file has dynamic components
    let hasGlobalDynamicComponents = false;
    for (const parsed of this.parsedFiles.values()) {
      if (parsed.hasDynamicComponents) {
        hasGlobalDynamicComponents = true;
        break;
      }
    }

    // Construct Edges
    for (const filePath of this.allFiles) {
      const parsed = this.parsedFiles.get(filePath);
      const indexed = this.fileIndexes.get(filePath);
      if (!parsed || !indexed) continue;

      const fileNodeId = `file:///${filePath}`;

      // A) Parent link edges: exported symbol -> parent file
      for (const exp of indexed.exports) {
        if (exp.name !== '*' && !exp.isReExport) {
          const symNodeId = `${fileNodeId}#${exp.name}`;
          graph.addEdge({
            from: symNodeId,
            to: fileNodeId,
            confidence: Confidence.HIGH,
            type: 'IMPORT'
          });
        }
      }

      // B) File level reference edges: parent file -> referenced symbol
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
        if (targetPath && this.fileIndexes.has(targetPath)) {
          const targetFileNodeId = `file:///${targetPath}`;

          for (const sym of imp.importedSymbols) {
            const localSymNodeId = `${fileNodeId}#${sym.localName}`;
            
            if (sym.isNamespace) {
              graph.addEdge({
                from: localSymNodeId,
                to: targetFileNodeId,
                confidence: Confidence.MEDIUM,
                type: 'IMPORT'
              });
              const targetIndex = this.fileIndexes.get(targetPath);
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
              graph.addEdge({
                from: localSymNodeId,
                to: `${targetFileNodeId}#default`,
                confidence: Confidence.HIGH,
                type: 'IMPORT'
              });
            } else {
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
          if (targetPath && this.fileIndexes.has(targetPath)) {
            const targetFileNodeId = `file:///${targetPath}`;

            if (exp.name === '*') {
              const targetIndex = this.fileIndexes.get(targetPath);
              if (targetIndex) {
                for (const targetExp of targetIndex.exports) {
                  if (targetExp.name !== '*') {
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
    if (hasGlobalDynamicComponents) {
      const componentFiles = this.allFiles.filter(f => {
        return f.includes('/components/') && f.endsWith('.vue');
      });

      for (const filePath of this.allFiles) {
        const parsed = this.parsedFiles.get(filePath);
        if (parsed?.hasDynamicComponents) {
          const fileNodeId = `file:///${filePath}`;
          for (const compFile of componentFiles) {
            const compFileNodeId = `file:///${compFile}`;
            graph.addEdge({
              from: fileNodeId,
              to: compFileNodeId,
              confidence: Confidence.UNKNOWN,
              type: 'TEMPLATE_REF'
            });
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
  }

  private generateReport(): DeadCodeReport {
    const graph = this.graph;
    const reachability = graph.computeReachability();
    const aliveNodeIds = reachability.aliveNodeIds;

    let hasGlobalDynamicComponents = false;
    for (const parsed of this.parsedFiles.values()) {
      if (parsed.hasDynamicComponents) {
        hasGlobalDynamicComponents = true;
        break;
      }
    }

    const fileReports: FileAnalysisReport[] = [];
    let deadFilesCount = 0;
    let deadSymbolsCount = 0;

    for (const filePath of this.allFiles) {
      const fileNodeId = `file:///${filePath}`;
      const isAlive = aliveNodeIds.has(fileNodeId);
      const fileIndex = this.fileIndexes.get(filePath);

      let status: 'ALIVE' | 'DEAD' | 'UNKNOWN' = isAlive ? 'ALIVE' : 'DEAD';
      let fileConfidence = Confidence.HIGH;

      const rawTrace = reachability.traces.get(fileNodeId);
      const tracePath = rawTrace ? rawTrace.map((t: string) => this.cleanNodeId(t)) : undefined;

      if (isAlive && rawTrace) {
        fileConfidence = this.computePathConfidence(rawTrace, graph);
      }

      if (!isAlive) {
        const isComponent = filePath.includes('/components/') && filePath.endsWith('.vue');
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

      let unusedProps: string[] | undefined = undefined;
      let unusedEmits: string[] | undefined = undefined;
      let unusedSlots: string[] | undefined = undefined;

      if (status === 'ALIVE' && filePath.endsWith('.vue') && fileIndex) {
        const declaredProps = fileIndex.declaredProps || [];
        const declaredEmits = fileIndex.declaredEmits || [];
        const declaredSlots = fileIndex.declaredSlots || [];

        const usedProps = new Set<string>();
        const usedEmits = new Set<string>();
        const usedSlots = new Set<string>();
        let bypassPropsAnalysis = false;
        let bypassEmitsAnalysis = false;

        // Traverse all other files to find usages of this child component
        for (const parentPath of this.allFiles) {
          const parentIndex = this.fileIndexes.get(parentPath);
          if (parentIndex && parentIndex.childUsages) {
            for (const usage of parentIndex.childUsages) {
              if (this.isUsageOfComponent(usage, parentPath, filePath, parentIndex)) {
                if (usage.hasDynamicProps) bypassPropsAnalysis = true;
                if (usage.hasDynamicEvents) bypassEmitsAnalysis = true;
                for (const p of usage.passedProps) usedProps.add(p);
                for (const e of usage.subscribedEvents) usedEmits.add(e);
                for (const s of usage.filledSlots) usedSlots.add(s);
              }
            }
          }
        }

        const norm = (s: string) => s.replace(/[-_]/g, '').toLowerCase();
        const usedPropsNormalized = new Set(Array.from(usedProps).map(norm));
        const usedEmitsNormalized = new Set(Array.from(usedEmits).map(norm));

        const unusedPropsList: string[] = [];
        if (!bypassPropsAnalysis) {
          for (const dp of declaredProps) {
            if (!usedPropsNormalized.has(norm(dp))) {
              unusedPropsList.push(dp);
            }
          }
        }

        const unusedEmitsList: string[] = [];
        if (!bypassEmitsAnalysis) {
          for (const de of declaredEmits) {
            if (!usedEmitsNormalized.has(norm(de))) {
              unusedEmitsList.push(de);
            }
          }
        }

        const unusedSlotsList: string[] = [];
        for (const ds of declaredSlots) {
          if (!usedSlots.has(ds)) {
            unusedSlotsList.push(ds);
          }
        }

        unusedProps = unusedPropsList.length > 0 ? unusedPropsList : undefined;
        unusedEmits = unusedEmitsList.length > 0 ? unusedEmitsList : undefined;
        unusedSlots = unusedSlotsList.length > 0 ? unusedSlotsList : undefined;
      }

      fileReports.push({
        path: filePath,
        status,
        confidence: fileConfidence,
        tracePath,
        reasons: status === 'DEAD' ? reasons : undefined,
        symbols: symbolsReport,
        unusedProps,
        unusedEmits,
        unusedSlots
      });
    }

    return {
      version: '1.0.0',
      engine: '@deadfinder/graph-v3',
      summary: {
        totalFiles: this.allFiles.length,
        deadFilesCount,
        deadSymbolsCount
      },
      files: fileReports
    };
  }

  private isUsageOfComponent(usage: any, parentPath: string, childPath: string, parentIndex: any): boolean {
    const childBaseName = path.basename(childPath, '.vue'); // e.g. "MyButton"
    const possibleNames = new Set<string>([childBaseName, childBaseName.toLowerCase()]);
    
    const kebabBase = childBaseName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    possibleNames.add(kebabBase);

    if (parentIndex && parentIndex.imports) {
      for (const imp of parentIndex.imports) {
        const resolvedTarget = this.resolveModulePath(parentPath, imp.moduleSpecifier);
        if (resolvedTarget === childPath) {
          for (const sym of imp.importedSymbols) {
            possibleNames.add(sym.localName);
            possibleNames.add(sym.localName.toLowerCase());
            const kebabLocal = sym.localName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
            possibleNames.add(kebabLocal);
          }
        }
      }
    }

    const tag = usage.componentName;
    const tagLower = tag.toLowerCase();
    const tagKebab = tag.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

    return possibleNames.has(tag) || possibleNames.has(tagLower) || possibleNames.has(tagKebab);
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
