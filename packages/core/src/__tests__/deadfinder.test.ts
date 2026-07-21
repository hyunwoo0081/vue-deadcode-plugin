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

    expect(indexed.imports.length).toBe(2);
    expect(indexed.imports[0].moduleSpecifier).toBe('./App.vue');
    expect(indexed.fileLevelReferences).toContain('App');
    expect(indexed.fileLevelReferences).toContain('unusedHelper');
  });

  it('should orchestrate analysis and correctly identify dead files and dead symbols', () => {
    const analyzer = new DeadCodeAnalyzer({ projectPath: mockProjectPath });
    const report = analyzer.analyze();

    expect(report.summary.totalFiles).toBe(6);
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
