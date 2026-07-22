import * as vscode from 'vscode';
import * as path from 'path';
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

    // Check if the file is ALIVE but has dead symbols (unused exports) or unused props/emits/slots
    const hasDeadExports = fileReport.symbols.some(s => s.status === 'DEAD');
    const hasUnusedInterfaces = (fileReport.unusedProps && fileReport.unusedProps.length > 0) ||
                                 (fileReport.unusedEmits && fileReport.unusedEmits.length > 0) ||
                                 (fileReport.unusedSlots && fileReport.unusedSlots.length > 0) ||
                                 (fileReport.unusedStoreMembers && fileReport.unusedStoreMembers.length > 0) ||
                                 (fileReport.unusedRoutes && fileReport.unusedRoutes.length > 0) ||
                                 (fileReport.unusedAssets && fileReport.unusedAssets.length > 0);

    if (hasDeadExports || hasUnusedInterfaces) {
      const items: string[] = [];
      if (hasDeadExports) {
        const deadSyms = fileReport.symbols.filter(s => s.status === 'DEAD').map(s => s.name);
        items.push(`Unused Exports: ${deadSyms.join(', ')}`);
      }
      if (fileReport.unusedProps && fileReport.unusedProps.length > 0) {
        items.push(`Unused Props: ${fileReport.unusedProps.join(', ')}`);
      }
      if (fileReport.unusedEmits && fileReport.unusedEmits.length > 0) {
        items.push(`Unused Emits: ${fileReport.unusedEmits.join(', ')}`);
      }
      if (fileReport.unusedSlots && fileReport.unusedSlots.length > 0) {
        items.push(`Unused Slots: ${fileReport.unusedSlots.join(', ')}`);
      }
      if (fileReport.unusedStoreMembers && fileReport.unusedStoreMembers.length > 0) {
        fileReport.unusedStoreMembers.forEach(s => {
          items.push(`Unused Store Members (${s.storeName}): ${s.members.join(', ')}`);
        });
      }
      if (fileReport.unusedRoutes && fileReport.unusedRoutes.length > 0) {
        items.push(`Unused Routes: ${fileReport.unusedRoutes.join(', ')}`);
      }
      if (fileReport.unusedAssets && fileReport.unusedAssets.length > 0) {
        items.push(`Unused Assets: ${fileReport.unusedAssets.map(a => path.basename(a)).join(', ')}`);
      }

      return {
        badge: hasUnusedInterfaces ? 'I' : 'U', // 'I' for unused interfaces, 'U' for unused exports
        tooltip: `Vue DeadFinder Warnings:\n- ${items.join('\n- ')}`,
        color: hasUnusedInterfaces
          ? new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
          : new vscode.ThemeColor('gitDecoration.untrackedResourceForeground'),
        propagate: false
      };
    }

    return undefined;
  }
}
