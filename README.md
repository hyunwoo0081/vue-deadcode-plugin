# 🔍 Vue DeadFinder (`@deadfinder/graph`)

Vue DeadFinder is a semantic graph engine and IDE suite designed to trace file, symbol, and template dependencies in Vue 3 & TypeScript applications. It maps the reachability of code starting from defined entry points and provides visual feedback to detect dead files and unused exports.

---

## 🚀 Key Features

1. **File-Symbol Hybrid Bi-directional Graph:** Tracks imports, exports, re-exports, and local symbol usages to determine exact reachability.
2. **Deep Vue Semantics:** Parses Vue SFC templates to detect component tags, event handlers (e.g. `@click="handler"`), data bindings, and interpolations (e.g. `{{ variable }}`) to avoid false positives.
3. **CI/CD Integration:** Integrates into build pipelines to warn or fail builds when dead code count exceeds threshold.
4. **Interactive Traceability (`explain`):** Explains exactly *why* a file is alive (trace path from entry point) or *why* it is dead (incoming dead references).
5. **Platform-Independent Engine:** Core graph engine compiles into a modular Node.js API, ready for IDE plugins (VS Code & WebStorm) and CLI clients.

---

## 📁 Repository Structure

```text
vue-deadcode/
├── packages/
│   ├── core/              # @deadfinder/core (The hybrid bi-directional graph engine)
│   └── cli/               # @deadfinder/cli (Command-line interface & CI/CD tool)
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

Compile the core engine and CLI package:

```bash
pnpm build
```

---

## 💻 CLI Usage

The CLI commands are executed using `@deadfinder/cli`. You can run them via `node` on the compiled script.

### 1. Analyze the project

Generates a text summary or a detailed JSON report identifying dead files and unused exports:

```bash
# General summary (Text format)
node packages/cli/dist/index.js analyze --project tests/fixtures/mock-project

# JSON Output
node packages/cli/dist/index.js analyze --project tests/fixtures/mock-project --format json
```

### 2. CI Pipeline Check

Ensures the project has less than a specific count of dead files. Returns Exit Code `1` if dead files exceed the limit:

```bash
node packages/cli/dist/index.js check --project tests/fixtures/mock-project --max-dead-files 0
```

### 3. Trace File Reachability

Traces the path from the entry point to the target file if it is alive, or shows which dead parent files import it if it is dead:

```bash
# Trace an alive file
node packages/cli/dist/index.js explain src/components/MyButton.vue --project tests/fixtures/mock-project

# Trace a dead file
node packages/cli/dist/index.js explain src/components/UnusedComponent.vue --project tests/fixtures/mock-project
```

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
