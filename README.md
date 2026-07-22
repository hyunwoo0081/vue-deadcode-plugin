# 🔍 Vue DeadFinder (`@deadfinder/graph`)

Vue DeadFinder is a semantic graph engine and IDE suite designed to trace file, symbol, and template dependencies in Vue 3 & TypeScript applications. It maps the reachability of code starting from defined entry points and provides visual feedback to detect dead files and unused exports.

---

## 🚀 Key Features

1. **File-Symbol Hybrid Bi-directional Graph:** Tracks imports, exports, re-exports, and local symbol usages to determine exact reachability.
2. **Deep Vue Semantics:** Parses Vue SFC templates to detect component tags, event handlers (e.g. `@click="handler"`), data bindings, and slot injects to avoid false positives.
3. **Pinia Stores Static Analysis:** Traces defined stores (`defineStore`) and flags unused state, action, and getter members even if the store is imported.
4. **Vue Router & Assets Analysis:** Flags route paths never navigated to, and unused images/static assets in `src/assets`.
5. **CI/CD Integration:** Integrates into build pipelines to warn or fail builds when dead code count exceeds threshold.
6. **Auto-Pruning:** Safely deletes dead files and assets with a dry-run feature and automatic backup to `.deadfinder-backup/`.
7. **Interactive Traceability (`explain`):** Explains exactly *why* a file is alive (trace path from entry point) or *why* it is dead (incoming dead references).
8. **Platform-Independent Engine:** Core graph engine compiles into a modular Node.js API, ready for IDE plugins (VS Code & WebStorm) and CLI clients.

---

## 📁 Repository Structure

```text
vue-deadcode/
├── packages/
│   ├── core/              # @deadfinder/core (The hybrid bi-directional graph engine)
│   ├── cli/               # @deadfinder/cli (Command-line interface & CI/CD tool)
│   └── vscode/            # @deadfinder/vscode (VS Code Extension)
├── docs/                  # Project specifications and architecture design docs
└── tests/
    └── fixtures/          # Test case fixtures (mock Vite/Vue 3 application)
```

---

## 🛠️ Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (v8+)

### Installation

Clone the repository and install the dependencies from the root directory:

```bash
pnpm install
```

### Build

Compile the core engine, CLI, and VS Code extension:

```bash
pnpm build
```

---

## 💻 CLI Usage

The CLI commands are executed using `@deadfinder/cli`. You can run them via `node` on the compiled script.

### 1. Analyze the project

Generates a text summary or a detailed JSON report identifying dead files, unused exports, unused store members, and unused assets:

```bash
# General summary (Text format)
node packages/cli/dist/index.js analyze --project tests/fixtures/mock-project

# JSON Output
node packages/cli/dist/index.js analyze --project tests/fixtures/mock-project --format json
```

### 2. CI Pipeline Check

Ensures the project has less than a specific count of dead files. Returns Exit Code `1` if dead files exceed the limit:

```bash
node packages/cli/dist/index.js check --project tests/fixtures/mock-project --max-dead-files 2
```

### 3. Trace File Reachability

Traces the path from the entry point to the target file if it is alive, or shows which dead parent files import it if it is dead:

```bash
# Trace an alive file
node packages/cli/dist/index.js explain src/components/MyButton.vue --project tests/fixtures/mock-project

# Trace a dead file
node packages/cli/dist/index.js explain src/components/UnusedComponent.vue --project tests/fixtures/mock-project
```

### 4. Auto-Pruning

Safely cleans up dead files and assets. Moving candidates to `.deadfinder-backup/` in the project root by default:

```bash
# Dry run (Preview only, no action)
node packages/cli/dist/index.js prune --project tests/fixtures/mock-project --dry-run

# Run pruning (Moves candidates to backup)
node packages/cli/dist/index.js prune --project tests/fixtures/mock-project

# Permanently delete (No backup)
node packages/cli/dist/index.js prune --project tests/fixtures/mock-project --force
```

---

## 🔌 IDE Integration

### 1. VS Code Extension Setup

You can build and install the VS Code extension directly from source.

#### Packaging the Extension
Navigate to the VS Code extension package folder and compile it into a `.vsix` file:
```bash
cd packages/vscode
npx vsce package
```
*(This produces `vue-deadfinder-vscode-1.0.0.vsix` in the directory).*

#### Installing the Extension
1. Open **VS Code**.
2. Open the **Extensions** side panel (`Ctrl+Shift+X`).
3. Click the `...` menu in the upper-right corner of the Extensions panel.
4. Click **Install from VSIX...**.
5. Select the generated `vue-deadfinder-vscode-1.0.0.vsix` file.

Once installed, it will automatically scan any Vue 3 project on file save, highlighting dead files as gray with a `D` badge and files containing warnings with an `I` badge.

---

### 2. WebStorm Integration

For WebStorm/IntelliJ, you can integrate the CLI analyzer as an **External Tool** to execute scans directly from your editor context menus.

#### Adding DeadFinder to External Tools
1. Open WebStorm settings (`Ctrl+Alt+S` or `Preferences`).
2. Go to **Tools -> External Tools**.
3. Click the `+` icon to add a new tool:
   - **Name:** `DeadFinder Analyze`
   - **Group:** `DeadFinder`
   - **Program:** `node` (or `deadfinder` if globally linked via `npm link`)
   - **Arguments:** `absolute_path_to/packages/cli/dist/index.js analyze --project $ProjectFileDir$`
   - **Working directory:** `$ProjectFileDir$`
4. Click **OK**.

#### Usage
Right-click on any file or directory in WebStorm's project panel, and select **External Tools -> DeadFinder -> DeadFinder Analyze**. The analysis report will output in WebStorm's run console.

---

## 🧪 Testing

We use [Vitest](https://vitest.dev/) for unit and integration testing:

```bash
pnpm test
```

---

## ⚙️ Technical Mechanics

- **Module Resolution:** Resolves imports with custom typescript aliases (`@/`), relative directories, folder indices (`/index.ts`), and resolves TypeScript ESM imports (`./utils.js` resolving physically to `utils.ts`).
- **Implicit Default Exports:** Automatically creates virtual default exports for `.vue` files to track default SFC registrations.
- **Dynamic Component Fallback:** Excludes components from dead code checks if dynamic tag resolutions (like `<component :is="dynamicVar" />`) are detected in the codebase, preventing false-positive deletions.
