export type NodeId = string; // e.g. "file:///src/utils.ts" or "file:///src/utils.ts#useUser"

export enum NodeType {
  FILE = 'FILE',
  SYMBOL = 'SYMBOL'
}

export enum Confidence {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  UNKNOWN = 'UNKNOWN'
}

export interface Node {
  id: NodeId;
  type: NodeType;
  path: string;
  symbolName?: string;
  isEntry: boolean;
}

export interface Edge {
  from: NodeId;
  to: NodeId;
  confidence: Confidence;
  type: 'IMPORT' | 'EXPORT' | 'TEMPLATE_REF' | 'RE_EXPORT';
}

export interface DeadCodeReport {
  version: '1.0.0';
  engine: '@deadfinder/graph-v3';
  summary: {
    totalFiles: number;
    deadFilesCount: number;
    deadSymbolsCount: number;
  };
  files: FileAnalysisReport[];
}

export interface FileAnalysisReport {
  path: string;
  status: 'ALIVE' | 'DEAD' | 'UNKNOWN';
  confidence: Confidence;
  tracePath?: string[]; // Path from entry to this node (if alive)
  reasons?: string[];   // Reason why it's considered dead
  symbols: SymbolAnalysisReport[];
  // Phase 3 additions:
  unusedProps?: string[];
  unusedEmits?: string[];
  unusedSlots?: string[];
}

export interface SymbolAnalysisReport {
  name: string;
  kind: 'function' | 'variable' | 'component' | 'type';
  line: number;
  status: 'ALIVE' | 'DEAD';
  confidence: Confidence;
}

export interface ImportInfo {
  moduleSpecifier: string;
  importedSymbols: {
    localName: string;
    propertyName?: string;
    isNamespace?: boolean;
    isDefault?: boolean;
  }[];
}

export interface ExportInfo {
  name: string;
  kind: 'function' | 'variable' | 'component' | 'type';
  line: number;
  isReExport?: boolean;
  reExportModule?: string;
  reExportSymbol?: string;
}

export interface LocalReference {
  fromSymbol: string;
  toSymbol: string;
}

export interface ChildComponentUsage {
  componentName: string; // e.g. "MyButton"
  passedProps: string[]; // e.g. ["size", "disabled"]
  subscribedEvents: string[]; // e.g. ["click"]
  filledSlots: string[]; // e.g. ["default", "header"]
  hasDynamicProps: boolean; // v-bind="obj"
  hasDynamicEvents: boolean; // v-on="obj"
}

export interface FileIndex {
  filePath: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  localReferences: LocalReference[];
  fileLevelReferences: string[];
  // Phase 3 component interface declarations
  declaredProps?: string[];
  declaredEmits?: string[];
  declaredSlots?: string[];
  childUsages?: ChildComponentUsage[];
}

