import * as vscode from 'vscode';
import * as path from 'path';
import { DeadCodeAnalyzer, resolveEntries, BiDirectionalGraph } from '@deadfinder/core';
import { DeadCodeDecorationProvider } from './decorationProvider.js';

let analyzer: DeadCodeAnalyzer | null = null;
let decorationProvider: DeadCodeDecorationProvider | null = null;
let outputChannel: vscode.OutputChannel | null = null;

export function activate(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const projectPath = workspaceFolders[0].uri.fsPath.replace(/\\/g, '/');
  
  // 1. Initialize core analyzer
  analyzer = new DeadCodeAnalyzer({ projectPath });
  const report = analyzer.analyze();

  // 2. Initialize and register decoration provider
  decorationProvider = new DeadCodeDecorationProvider();
  decorationProvider.updateReport(report);
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(decorationProvider)
  );

  // 3. Initialize output channel for explain command
  outputChannel = vscode.window.createOutputChannel("Vue DeadFinder");
  context.subscriptions.push(outputChannel);

  // 4. File Watcher (triggered on save)
  const onSaveSubscription = vscode.workspace.onDidSaveTextDocument((document) => {
    const filePath = document.uri.fsPath.replace(/\\/g, '/');
    if (isAnalyzableFile(filePath)) {
      triggerAnalysisUpdate(filePath);
    }
  });
  context.subscriptions.push(onSaveSubscription);

  // 5. Register explain command
  const explainCommand = vscode.commands.registerCommand('deadfinder.explain', (uri: vscode.Uri) => {
    let targetUri = uri;
    if (!targetUri && vscode.window.activeTextEditor) {
      targetUri = vscode.window.activeTextEditor.document.uri;
    }
    if (!targetUri) {
      vscode.window.showWarningMessage('No file selected to explain.');
      return;
    }

    const filePath = targetUri.fsPath.replace(/\\/g, '/');
    const explanation = getExplanationText(filePath, projectPath);
    
    if (outputChannel) {
      outputChannel.clear();
      outputChannel.appendLine(explanation);
      outputChannel.show(true);
    }
  });
  context.subscriptions.push(explainCommand);
}

// Extensible wrapper for queuing, debouncing, or moving updates to worker threads in the future
function triggerAnalysisUpdate(filePath: string) {
  if (!analyzer || !decorationProvider) {
    return;
  }
  
  // Perform incremental file scan and rebuild reachability graph
  const updatedReport = analyzer.updateFile(filePath);
  decorationProvider.updateReport(updatedReport);
}

function isAnalyzableFile(filePath: string): boolean {
  const ext = path.extname(filePath);
  return ['.vue', '.ts', '.js', '.tsx', '.jsx'].includes(ext);
}

function getExplanationText(filePath: string, projectPath: string): string {
  if (!analyzer) {
    return 'Analyzer not initialized.';
  }
  const report = analyzer.analyze(); // get latest report
  const graph = analyzer.graph;

  const fileReport = report.files.find(f => path.resolve(f.path) === path.resolve(filePath));
  if (!fileReport) {
    return `File is not part of the analyzed project source files: ${filePath}`;
  }

  const relPath = path.relative(projectPath, filePath);
  let out = `[${fileReport.status} FILE] ${relPath}\n`;
  out += `Status: ${fileReport.status}\n`;
  out += `Confidence: ${fileReport.confidence}\n\n`;

  if (fileReport.status === 'ALIVE') {
    out += `Traceability Graph Analysis:\n`;
    if (fileReport.tracePath && fileReport.tracePath.length > 0) {
      out += `  ✓ Entry Point: ${path.relative(projectPath, fileReport.tracePath[0])}\n`;
      for (let i = 1; i < fileReport.tracePath.length; i++) {
        const connector = i === fileReport.tracePath.length - 1 ? '└─►' : '├─►';
        const node = fileReport.tracePath[i];
        const isSymbol = node.includes('#');
        const cleanPath = node.split('#')[0];
        const symbolPart = isSymbol ? ` (${node.split('#')[1]})` : '';
        out += `  ${connector} ${path.relative(projectPath, cleanPath)}${symbolPart} (Alive)\n`;
      }
    } else {
      out += `  ✓ Entry Point: This file is itself an entry point.\n`;
    }
  } else {
    out += `Traceability Graph Analysis:\n`;
    const entries = resolveEntries(projectPath);
    if (entries.length > 0) {
      out += `  ✗ Entry Point: ${path.relative(projectPath, entries[0])}\n`;
    } else {
      out += `  ✗ Entry Point: (No entry point resolved)\n`;
    }

    const fileNodeId = `file:///${filePath.replace(/\\/g, '/')}`;
    const aliveNodeIds = graph.computeReachability().aliveNodeIds;
    const deadRefs = getDeadIncomingChain(fileNodeId, graph);

    if (deadRefs.length > 0) {
      out += `  └─x (No reachable edge from alive nodes)\n\n`;
      out += `Imported/Referenced by:\n`;
      const printed = new Set<string>();
      for (const ref of deadRefs) {
        if (printed.has(ref)) {
          continue;
        }
        printed.add(ref);

        const isSymbol = ref.includes('#');
        const refFile = ref.split('#')[0].replace('file:///', '');
        if (path.resolve(refFile) === path.resolve(filePath)) {
          continue;
        }

        const relRefFile = path.relative(projectPath, refFile);
        const isAlive = aliveNodeIds.has(ref);
        const statusText = isAlive ? 'ALIVE' : 'DEAD';

        if (isSymbol) {
          const symName = ref.split('#')[1];
          out += `  └─ ${relRefFile} (Symbol '${symName}' is ${statusText})\n`;
        } else {
          out += `  └─ ${relRefFile} (${statusText})\n`;
        }
      }
    } else {
      out += `  └─x (No reachable edge to ${path.basename(filePath)})\n`;
    }

    out += `\nReasons:\n`;
    fileReport.reasons?.forEach((reason, index) => {
      out += `  ${index + 1}. ${reason}\n`;
    });
  }

  return out;
}

function getDeadIncomingChain(nodeId: string, graph: BiDirectionalGraph, visited = new Set<string>()): string[] {
  if (visited.has(nodeId)) {
    return [];
  }
  visited.add(nodeId);

  const incoming = graph.getIncomingEdges(nodeId);
  const chain: string[] = [];

  for (const edge of incoming) {
    const fromFile = edge.from.split('#')[0];
    const toFile = nodeId.split('#')[0];
    if (fromFile !== toFile) {
      chain.push(edge.from);
      chain.push(...getDeadIncomingChain(edge.from, graph, visited));
    }
  }

  if (!nodeId.includes('#')) {
    for (const [id, node] of graph.nodes.entries()) {
      if (id.startsWith(nodeId + '#')) {
        const symIncoming = graph.getIncomingEdges(id);
        for (const edge of symIncoming) {
          const fromFile = edge.from.split('#')[0];
          if (fromFile !== nodeId) {
            chain.push(edge.from);
            chain.push(...getDeadIncomingChain(edge.from, graph, visited));
          }
        }
      }
    }
  }

  return chain;
}

export function deactivate() {
  analyzer = null;
  decorationProvider = null;
  outputChannel = null;
}
