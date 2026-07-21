# 📄 [최종 기획 및 기술 설계서] Vue Semantic Graph Engine & IDE Suite: **Vue DeadFinder**

---

## 1. 프로젝트 개요 및 비전 (Vision)

* **프로젝트명:** Vue DeadFinder (`@deadfinder/graph`)
* **핵심 비전:** Vue 3 및 TypeScript 프로젝트의 파일·Symbol·템플릿 관계를 추적하는 의미론적 그래프 엔진(Semantic Graph Engine)을 구축하고, 이를 기반으로 **Dead Code를 IDE 파일 탐색기(Explorer)에서 즉시 시각화**하는 개발자 생산성 도구.
* **핵심 차별성:**
1. 단순 AST 구문 분석을 넘어 **Symbol Node 레벨의 도달 가능성(Reachability) 분석** 수행
2. IDE Problems 창이 아닌 **파일 탐색기(Tree Node) 상에서 직관적인 visual feedback** 제공
3. CI/CD, CLI, VS Code, WebStorm 등 모든 플랫폼이 동일한 **Core Graph Engine API** 재사용

---

## 2. 전체 시스템 아키텍처 (System Architecture)

Core Engine을 독립된 Node.js 기반 모듈로 설계하고, CLI와 각 IDE Plugin은 오직 **View & Reporter** 역할만 담당하는 **LSP(Language Server Protocol) 스타일 모노레포 구조**를 채택합니다.

```text
vue-deadfinder/
├── packages/
│   ├── core/              # @deadfinder/graph (의미론적 그래프 분석 엔진)
│   ├── cli/               # @deadfinder/cli (전역 CLI 분석 및 CI 도구)
│   ├── vscode/            # VS Code Extension (FileDecorationProvider 연동)
│   └── webstorm/          # WebStorm Plugin (IntelliJ SDK / ProjectViewNodeDecorator)
```

### Data Pipeline Architecture

```text
[ Raw Source Files (.vue, .ts, .js) ]
                │
                ▼
      ┌───────────────────┐
      │  Parsers & AST    │ (Vue SFC / TS Compiler API)
      └─────────┬─────────┘
                │ Raw AST
                ▼
      ┌───────────────────┐
      │      Indexer      │ (Symbol, Import, Export Extraction)
      └─────────┬─────────┘
                │ Indexed Symbols
                ▼
      ┌───────────────────┐
      │   Graph Builder   │ (File + Symbol Hybrid Bi-directional Graph)
      └─────────┬─────────┘
                │ Unified Graph
                ▼
      ┌───────────────────┐
      │  Analysis Engine  │ (Root Traversal & Reachability Query)
      └─────────┬─────────┘
                │
                ▼
      ┌───────────────────┐
      │  DeadCodeReport   │ (JSON Protocol v1.0.0)
      └─────────┬─────────┘
                │
      ┌─────────┴─────────┐
      ▼                   ▼
[ CLI / CI Tool ]   [ IDE Extension ] ──> File Explorer UI Decoration
```

---

## 3. 핵심 모듈별 상세 설계

### 3.1 File-Symbol Hybrid Bi-directional Graph Engine (`@deadfinder/core`)

`refCount` 등의 가변 변수를 배제하고, **Node(File/Symbol)와 Edge(Import/Export/TemplateRef)로 구성된 방향성 그래프의 Reachability**로 Alive/Dead를 수학적으로 도출합니다.

* **Graph Data Model:**
```typescript
export type NodeId = string; // e.g. "file:///src/utils.ts" 또는 "file:///src/utils.ts#useUser"

export enum NodeType { FILE = 'FILE', SYMBOL = 'SYMBOL' }
export enum Confidence { HIGH = 'HIGH', MEDIUM = 'MEDIUM', LOW = 'LOW', UNKNOWN = 'UNKNOWN' }

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
```

* **Bi-directional Mapping:**
`outgoingEdges`(Forward Traversal용)와 `incomingEdges`(Reverse Trace 및 Incremental Invalidation 전파용)를 상호 유지하여 **수정된 파일의 상위/하위 영향 범위를 최소한으로 재분석**합니다.

### 3.2 Root Discovery Layer (`RootResolver`)

프레임워크 환경에 따라 진입점(Entry Points)을 유연하게 탐지하는 플러그인 레이어입니다.

* **Vite Resolver:** `index.html` 분석 후 `main.ts` / `main.js` 도출
* **Nuxt Resolver:** `app.vue`, `pages/**/*.vue`, `layouts/**/*.vue`, `server/routes/**/*.ts` 자동 수집
* **Library / Custom Resolver:** `package.json`의 `main`/`module` 필드 및 사용자가 지정한 `entryPatterns` 감지

### 3.3 Confidence (신뢰도) 시스템

Vue 구문 표현의 다양성(동적 컴포넌트, Auto Import 등)으로 인한 오탐(False Positive)을 막기 위해 Enum 기반 신뢰도를 부여합니다.

| 분류 | 조건 | Confidence | IDE 표현 전략 |
| --- | --- | --- | --- |
| **HIGH** | 정적 `import` 및 `<script setup>` 내 direct component 태그 참조 | `HIGH` | 탐색기 회색 하이라이팅 + Dead 배지 |
| **MEDIUM** | Barrel Export(`export *`) 경유, `unplugin-vue-components` Auto-import | `MEDIUM` | 탐색기 회색 하이라이팅 |
| **LOW** | `defineAsyncComponent()`, `resolveComponent('MyButton')` 사용 | `LOW` | Warning 배지 표시 (실제 삭제 시 주의 필요) |
| **UNKNOWN** | `<component :is="dynamicVar" />` 등 완전 동적 구문 사용 | `UNKNOWN` | **Dead 처리에서 제외** (오탐 방지) |

---

## 4. API Contract & Output Spec (`DeadCodeReport`)

CLI, VS Code, WebStorm, GitHub Action이 공통 소비하는 Standard JSON Schema (v1.0.0)입니다.

```typescript
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
  tracePath?: string[]; // Entry부터 도달 경로 (Alive인 경우)
  reasons?: string[];   // Dead 판정 이유 (Explainability)
  symbols: SymbolAnalysisReport[];
}

export interface SymbolAnalysisReport {
  name: string;
  kind: 'function' | 'variable' | 'component' | 'type';
  line: number;
  status: 'ALIVE' | 'DEAD';
  confidence: Confidence;
}
```

---

## 5. IDE Client 별 UI/UX 스펙

### 5.1 VS Code Client (`packages/vscode`)

* **API:** `vscode.FileDecorationProvider`
* **UX 표현:**
* **Dead File:** 파일 탐색기 이름 색상을 `Disabled Foreground`(연회색)으로 변경, 우측 Badge **`[D]`** 부착
* **Dead Export 보유 File:** 우측 Badge **`[U]`** (Unused Export) 부착
* **Explain Command:** 파일 우클릭 ➡️ `DeadFinder: Explain Why Dead` 실행 시 Output Channel에 도달 실패 경로(Trace) 출력

### 5.2 WebStorm Client (`packages/webstorm`)

* **API:** `ProjectViewNodeDecorator`, `PsiTreeChangeListener`
* **UX 표현:**
* **Dead File:** 탐색기 파일 트리의 폰트 회색/취소선 처리, 아이콘 위에 **경고 오버레이(☠️/❌)** 추가
* **Dead Export 보유 File:** 노드 우측에 경고 도트(Dot) 배지 생성

---

## 6. CLI First & Traceability

### 6.1 Command Line Interface (`@deadfinder/cli`)

```bash
# 전체 프로젝트 분석 후 JSON 리포트 생성
$ deadfinder analyze --project ./my-vue-app --format json > report.json

# CI/CD 빌드 파이프라인 검사 (Dead Code 존재 시 Exit Code 1 반환)
$ deadfinder check --ci --max-dead-files 0

# 특정 파일의 Dead 사유 및 도달 경로 추적 (Explainability)
$ deadfinder explain src/components/OldButton.vue
```

### 6.2 `deadfinder explain` 실행 예시

```text
[DEAD FILE] src/components/OldButton.vue
Status: DEAD
Confidence: HIGH

Traceability Graph Analysis:
  ✗ Entry Point: src/main.ts
  └─► src/App.vue (Alive)
      └─► src/views/HomeView.vue (Alive)
          └─► src/components/Header.vue (Alive)
              └─x (No reachable edge to OldButton.vue)

Reasons:
  1. No import statement found in any reachable JavaScript/TypeScript files.
  2. No template reference (<OldButton> or <old-button>) found in reachable Vue SFCs.
  3. Not registered globally via app.component().
```

---

## 7. 성능 및 증분 분석 전략 (Incremental Engine)

4,000개 이상의 대형 Vue 프로젝트에서 **파일 저장 시 50ms 이내 탐색기 반영**을 목표로 합니다.

```text
[ File 'B.ts' Saved ]
          │
          ▼
1. File Watcher 감지
          │
          ▼
2. Incoming Edges 역추적 ──► 영향을 받는 상위 Node A 및 하위 Node C 마킹
          │
          ▼
3. 'B.ts' 단일 파일 Partial AST Re-parsing & Indexing
          │
          ▼
4. Local Graph Edge 재구축 및 서브트리 Partial BFS Traversal
          │
          ▼
5. IDE FileDecoration Provider에 부분 UI Update 이벤트 발송 (< 50ms)
```

---

## 8. 단계별 개발 로드맵 (Roadmap)

### Phase 1: Core Graph & CLI First (v1.0)

* [ ] `@vue/compiler-sfc` + TS Compiler API 기반 Parser & Indexer 개발
* [ ] File-Symbol Hybrid Bi-directional Graph Data Structure 구축
* [ ] Root Discovery Engine (Vite / Nuxt / Custom) 작성
* [ ] `@deadfinder/cli` (`analyze`, `check`, `explain` 명령어) 구현

### Phase 2: IDE Clients & Explorer Decoration (v1.5)

* [ ] VS Code Extension (`FileDecorationProvider`) 구현
* [ ] WebStorm Plugin (`ProjectViewNodeDecorator`) 구현
* [ ] Incremental Analysis File Watcher 엔진 연동

### Phase 3: Vue Deep Semantics Expansion (v2.0)

* [ ] **Unused Props / Emits / Slots Query:** 부모-자식 간 미사용 인터페이스 감지
* [ ] **Unused Pinia Store Query:** 정의 후 쓰이지 않는 State/Action 감지
* [ ] **Unused Router & Assets Query:** 미도달 라우트 및 안 쓰는 `assets/` 이미지 감지
