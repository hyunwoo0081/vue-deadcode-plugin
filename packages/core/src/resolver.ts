import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';

export function resolveEntries(projectPath: string, customPatterns?: string[]): string[] {
  let resolvedEntries: string[] = [];

  // 1. Custom Patterns
  if (customPatterns && customPatterns.length > 0) {
    const matched = fg.sync(customPatterns, { cwd: projectPath, absolute: true });
    if (matched.length > 0) {
      resolvedEntries = matched;
    }
  }

  // 2. Nuxt Check
  if (resolvedEntries.length === 0) {
    const hasNuxtConfig =
      fs.existsSync(path.join(projectPath, 'nuxt.config.ts')) ||
      fs.existsSync(path.join(projectPath, 'nuxt.config.js'));
    if (hasNuxtConfig) {
      const nuxtPatterns = [
        'app.vue',
        'pages/**/*.vue',
        'layouts/**/*.vue',
        'server/routes/**/*.ts'
      ];
      const matched = fg.sync(nuxtPatterns, { cwd: projectPath, absolute: true });
      if (matched.length > 0) {
        resolvedEntries = matched;
      }
    }
  }

  // 3. Vite Check
  if (resolvedEntries.length === 0) {
    const indexHtmlPath = path.join(projectPath, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      const htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');
      const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["']/gi;
      let match;
      const foundScripts: string[] = [];
      while ((match = scriptRegex.exec(htmlContent)) !== null) {
        const src = match[1];
        const relativePath = src.startsWith('/') ? src.slice(1) : src;
        const scriptPath = path.resolve(projectPath, relativePath);
        if (fs.existsSync(scriptPath)) {
          foundScripts.push(scriptPath);
        }
      }
      if (foundScripts.length > 0) {
        resolvedEntries = foundScripts;
      }
    }
  }

  // 4. Library / package.json check
  if (resolvedEntries.length === 0) {
    const pkgJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        const fields = [pkg.module, pkg.main];
        if (pkg.exports && pkg.exports['.']) {
          if (typeof pkg.exports['.'] === 'string') {
            fields.push(pkg.exports['.']);
          } else {
            fields.push(pkg.exports['.'].import);
            fields.push(pkg.exports['.'].require);
          }
        }
        const entries: string[] = [];
        for (const field of fields) {
          if (typeof field === 'string') {
            const resolved = path.resolve(projectPath, field);
            if (fs.existsSync(resolved)) {
              entries.push(resolved);
            }
          }
        }
        if (entries.length > 0) {
          resolvedEntries = entries;
        }
      } catch (_) {}
    }
  }

  // 5. Default Fallbacks
  if (resolvedEntries.length === 0) {
    const defaults = [
      'src/main.ts',
      'src/main.js',
      'src/index.ts',
      'src/index.js',
      'main.ts',
      'main.js',
      'index.ts',
      'index.js'
    ];
    for (const d of defaults) {
      const resolved = path.resolve(projectPath, d);
      if (fs.existsSync(resolved)) {
        resolvedEntries = [resolved];
        break;
      }
    }
  }

  return resolvedEntries.map(p => p.replace(/\\/g, '/'));
}
