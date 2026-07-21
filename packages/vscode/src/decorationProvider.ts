import * as vscode from 'vscode';
import { DeadCodeReport } from '@deadfinder/core';

export class DeadCodeDecorationProvider implements vscode.FileDecorationProvider {
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[]>;
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  
  private latestReport: DeadCodeReport | null = null;

  constructor() {
    this.onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
  }

  updateReport(report: DeadCodeReport): void {
    this.latestReport = report;
    // Fire undefined to refresh decorations workspace-wide
    this._onDidChangeFileDecorations.fire(undefined as any);
  }

  provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
    if (!this.latestReport) {
      return undefined;
    }

    const filePath = uri.fsPath.replace(/\\/g, '/');

    // Find matching file in report
    const fileReport = this.latestReport.files.find(f => f.path.replace(/\\/g, '/') === filePath);
    if (!fileReport) {
      return undefined;
    }

    if (fileReport.status === 'DEAD') {
      return {
        badge: 'D',
        tooltip: `Vue DeadFinder: File is DEAD (${fileReport.confidence} confidence)`,
        color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
        propagate: false
      };
    }

    if (fileReport.status === 'UNKNOWN') {
      return {
        badge: '?',
        tooltip: 'Vue DeadFinder: Unknown reachability (dynamic component source)',
        color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
        propagate: false
      };
    }

    // Check if the file is ALIVE but has dead symbols (unused exports)
    const hasDeadExports = fileReport.symbols.some(s => s.status === 'DEAD');
    if (hasDeadExports) {
      return {
        badge: 'U',
        tooltip: 'Vue DeadFinder: File contains unused exports',
        color: new vscode.ThemeColor('gitDecoration.untrackedResourceForeground'),
        propagate: false
      };
    }

    return undefined;
  }
}
