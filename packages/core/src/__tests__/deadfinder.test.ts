import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { resolveEntries } from '../resolver.js';
import { parseFile } from '../parser.js';
import { indexSource } from '../indexer.js';
import { DeadCodeAnalyzer } from '../analyzer.js';

const mockProjectPath = path.resolve(__dirname, '../../../../tests/fixtures/mock-project');

describe('Vue DeadFinder Core Engine', () => {
  it('should resolve entry points correctly from index.html (Vite)', () => {
    const entries = resolveEntries(mockProjectPath);
    expect(entries.length).toBe(1);
    expect(entries[0].endsWith('src/main.ts')).toBe(true);
  });

  it('should parse Vue SFC and extract script and template tag details', () => {
    const appVuePath = path.join(mockProjectPath, 'src/App.vue');
    const parsed = parseFile(appVuePath);
    expect(parsed.isVue).toBe(true);
    expect(parsed.scriptLang).toBe('ts');
    expect(parsed.scriptContent).toContain('MyButton');
    expect(parsed.templateTags).toContain('MyButton');
  });

  it('should index imports, exports, and references from source code', () => {
    const mainTsPath = path.join(mockProjectPath, 'src/main.ts');
    const parsed = parseFile(mainTsPath);
    const indexed = indexSource(mainTsPath, parsed.scriptContent, parsed.templateTags);

    expect(indexed.imports.length).toBe(4);
    expect(indexed.imports.some(imp => imp.moduleSpecifier === './App.vue')).toBe(true);
    expect(indexed.fileLevelReferences).toContain('App');
    expect(indexed.fileLevelReferences).toContain('unusedHelper');
  });

  it('should orchestrate analysis and correctly identify dead files and dead symbols', () => {
    const analyzer = new DeadCodeAnalyzer({ projectPath: mockProjectPath });
    const report = analyzer.analyze();

    expect(report.summary.totalFiles).toBe(8);
    expect(report.summary.deadFilesCount).toBe(2);

    const appReport = report.files.find(f => f.path.replace(/\\/g, '/').endsWith('src/App.vue'));
    expect(appReport?.status).toBe('ALIVE');

    const orphanReport = report.files.find(f => f.path.replace(/\\/g, '/').endsWith('src/components/OrphanComponent.vue'));
    expect(orphanReport?.status).toBe('DEAD');

    const unusedReport = report.files.find(f => f.path.replace(/\\/g, '/').endsWith('src/components/UnusedComponent.vue'));
    expect(unusedReport?.status).toBe('DEAD');

    const utilsReport = report.files.find(f => f.path.replace(/\\/g, '/').endsWith('src/utils.ts'));
    expect(utilsReport?.status).toBe('ALIVE');

    const deadHelper = utilsReport?.symbols.find(s => s.name === 'deadHelper');
    expect(deadHelper?.status).toBe('DEAD');

    const unusedHelper = utilsReport?.symbols.find(s => s.name === 'unusedHelper');
    expect(unusedHelper?.status).toBe('ALIVE');

    const buttonReport = report.files.find(f => f.path.replace(/\\/g, '/').endsWith('src/components/MyButton.vue'));
    expect(buttonReport?.status).toBe('ALIVE');
    expect(buttonReport?.unusedProps).toContain('disabled');
    expect(buttonReport?.unusedProps).toContain('size');
    expect(buttonReport?.unusedProps).not.toContain('label');
    expect(buttonReport?.unusedEmits).toContain('change');
    expect(buttonReport?.unusedEmits).toContain('hover');
    expect(buttonReport?.unusedEmits).not.toContain('click');
    expect(buttonReport?.unusedSlots).toContain('icon');
    expect(buttonReport?.unusedSlots).not.toContain('default');

    // Pinia verification
    const storeReport = report.files.find(f => f.path.replace(/\\/g, '/').endsWith('src/store/counter.ts'));
    expect(storeReport?.status).toBe('ALIVE');
    const storeObj = storeReport?.unusedStoreMembers?.find(s => s.storeName === 'useCounterStore');
    expect(storeObj?.members).toContain('unusedState');
    expect(storeObj?.members).toContain('unusedGetter');
    expect(storeObj?.members).toContain('unusedAction');
    expect(storeObj?.members).toContain('count');
    expect(storeObj?.members).not.toContain('increment');
    expect(storeObj?.members).not.toContain('doubleCount');

    // Router verification
    const routerReport = report.files.find(f => f.path.replace(/\\/g, '/').endsWith('src/router/index.ts'));
    expect(routerReport?.status).toBe('ALIVE');
    expect(routerReport?.unusedRoutes).toContain('/unused-route');
    expect(routerReport?.unusedRoutes).not.toContain('/about');

    // Assets verification
    const mainReport = report.files.find(f => f.path.replace(/\\/g, '/').endsWith('src/main.ts'));
    const hasUnusedLogo = mainReport?.unusedAssets?.some(a => a.endsWith('logo.png'));
    const hasUnusedImage = mainReport?.unusedAssets?.some(a => a.endsWith('unused-image.png'));
    expect(hasUnusedLogo).toBe(false);
    expect(hasUnusedImage).toBe(true);
  });

  it('should incrementally update when a file is saved', () => {
    const tempDir = path.resolve(__dirname, '../../../../tests/fixtures/temp-mock-project-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    fs.cpSync(mockProjectPath, tempDir, { recursive: true });

    try {
      const analyzer = new DeadCodeAnalyzer({ projectPath: tempDir });
      const initialReport = analyzer.analyze();

      const orphanReport = initialReport.files.find(f => f.path.replace(/\\/g, '/').endsWith('src/components/OrphanComponent.vue'));
      expect(orphanReport?.status).toBe('DEAD');

      // Now modify App.vue in tempDir to reference OrphanComponent in template
      const appVuePath = path.join(tempDir, 'src/App.vue');
      const newAppContent = `<script setup lang="ts">
import MyButton from './components/MyButton.vue';
import UnusedComponent from './components/UnusedComponent.vue';
import OrphanComponent from './components/OrphanComponent.vue';
</script>

<template>
  <div>
    <MyButton />
    <OrphanComponent />
  </div>
</template>`;
      fs.writeFileSync(appVuePath, newAppContent, 'utf-8');

      // Run incremental update
      const updatedReport = analyzer.updateFile(appVuePath);

      // Verify that OrphanComponent is now ALIVE!
      const updatedOrphan = updatedReport.files.find(f => f.path.replace(/\\/g, '/').endsWith('src/components/OrphanComponent.vue'));
      expect(updatedOrphan?.status).toBe('ALIVE');

      // Verify that UnusedComponent is still DEAD
      const updatedUnused = updatedReport.files.find(f => f.path.replace(/\\/g, '/').endsWith('src/components/UnusedComponent.vue'));
      expect(updatedUnused?.status).toBe('DEAD');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
