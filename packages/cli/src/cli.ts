import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { DeadCodeAnalyzer, resolveEntries, BiDirectionalGraph } from '@deadfinder/core';

const program = new Command();

program
  .name('deadfinder')
  .description('Vue Semantic Graph Engine & IDE Suite CLI')
  .version('1.0.0');

program
  .command('analyze')
  .description('Analyze the project for dead code')
  .option('-p, --project <path>', 'Path to project root', '.')
  .option('-f, --format <format>', 'Output format (json | text)', 'text')
  .action((options) => {
    const projectPath = path.resolve(options.project);
    if (!fs.existsSync(projectPath)) {
      console.error(chalk.red(`Project path does not exist: ${options.project}`));
      process.exit(1);
    }

    const analyzer = new DeadCodeAnalyzer({ projectPath });
    const report = analyzer.analyze();

    if (options.format === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(chalk.bold(`\nVue DeadFinder Analysis Report`));
      console.log(chalk.gray(`==============================`));
      console.log(`Total Files:   ${report.summary.totalFiles}`);
      console.log(`Dead Files:    ${chalk.red(report.summary.deadFilesCount)}`);
      console.log(`Dead Symbols:  ${chalk.red(report.summary.deadSymbolsCount)}\n`);

      const deadFiles = report.files.filter(f => f.status === 'DEAD');
      if (deadFiles.length > 0) {
        console.log(chalk.bold.red('Dead Files:'));
        deadFiles.forEach(f => {
          const relPath = path.relative(projectPath, f.path);
          console.log(`  ✗ ${chalk.gray(relPath)} (${chalk.yellow(f.confidence)} confidence)`);
        });
      } else {
        console.log(chalk.green('✓ No dead files found!'));
      }

      const deadSymbols = report.files.flatMap(f =>
        f.symbols
          .filter(s => s.status === 'DEAD')
          .map(s => ({
            filePath: f.path,
            name: s.name,
            line: s.line,
            confidence: s.confidence
          }))
      );
      if (deadSymbols.length > 0) {
        console.log(chalk.bold.yellow('\nDead Exports (Unused exports):'));
        deadSymbols.forEach(s => {
          const relPath = path.relative(projectPath, s.filePath);
          console.log(`  ✗ ${chalk.gray(relPath)}:${s.line} - export '${chalk.yellow(s.name)}' (${chalk.yellow(s.confidence)} confidence)`);
        });
      }

      // Unused Vue interfaces (Props / Emits / Slots)
      const filesWithUnusedInterfaces = report.files.filter(
        f => f.unusedProps || f.unusedEmits || f.unusedSlots
      );
      if (filesWithUnusedInterfaces.length > 0) {
        console.log(chalk.bold.cyan('\nUnused Vue Interfaces (Props / Emits / Slots):'));
        filesWithUnusedInterfaces.forEach(f => {
          const relPath = path.relative(projectPath, f.path);
          console.log(`  🏢 ${chalk.bold.gray(relPath)}:`);
          if (f.unusedProps && f.unusedProps.length > 0) {
            console.log(`    ${chalk.blue('Props:')}  ${f.unusedProps.join(', ')}`);
          }
          if (f.unusedEmits && f.unusedEmits.length > 0) {
            console.log(`    ${chalk.magenta('Emits:')}  ${f.unusedEmits.join(', ')}`);
          }
          if (f.unusedSlots && f.unusedSlots.length > 0) {
            console.log(`    ${chalk.yellow('Slots:')}  ${f.unusedSlots.join(', ')}`);
          }
        });
      }

      // Unused Pinia Store Members
      const filesWithUnusedStores = report.files.filter(f => f.unusedStoreMembers);
      if (filesWithUnusedStores.length > 0) {
        console.log(chalk.bold.green('\nUnused Pinia Store Members:'));
        filesWithUnusedStores.forEach(f => {
          const relPath = path.relative(projectPath, f.path);
          console.log(`  🍍 ${chalk.bold.gray(relPath)}:`);
          f.unusedStoreMembers?.forEach(store => {
            console.log(`    ${chalk.green(store.storeName + ':')}  ${store.members.join(', ')}`);
          });
        });
      }

      // Unused Routes
      const filesWithUnusedRoutes = report.files.filter(f => f.unusedRoutes);
      if (filesWithUnusedRoutes.length > 0) {
        console.log(chalk.bold.magenta('\nUnused Routes:'));
        filesWithUnusedRoutes.forEach(f => {
          const relPath = path.relative(projectPath, f.path);
          console.log(`  🛣️  ${chalk.bold.gray(relPath)}:`);
          console.log(`    ${chalk.magenta('Paths:')}  ${f.unusedRoutes?.join(', ')}`);
        });
      }

      // Unused Assets
      const entryReports = report.files.filter(f => f.unusedAssets);
      if (entryReports.length > 0) {
        console.log(chalk.bold.yellow('\nUnused Static Assets (Images/Media):'));
        entryReports.forEach(f => {
          f.unusedAssets?.forEach(asset => {
            const relAsset = path.relative(projectPath, asset);
            console.log(`  🖼️  ${chalk.yellow(relAsset)}`);
          });
        });
      }
    }
  });

program
  .command('check')
  .description('CI/CD checks for dead code')
  .option('-p, --project <path>', 'Path to project root', '.')
  .option('--ci', 'Enable CI mode', false)
  .option('--max-dead-files <count>', 'Maximum allowable dead files', '0')
  .action((options) => {
    const projectPath = path.resolve(options.project);
    if (!fs.existsSync(projectPath)) {
      console.error(chalk.red(`Project path does not exist: ${options.project}`));
      process.exit(1);
    }

    const maxDead = parseInt(options.maxDeadFiles, 10);
    const analyzer = new DeadCodeAnalyzer({ projectPath });
    const report = analyzer.analyze();

    const deadFiles = report.summary.deadFilesCount;
    if (deadFiles > maxDead) {
      console.error(chalk.red(`\n[FAIL] Dead files count (${deadFiles}) exceeds limit (${maxDead}).`));
      process.exit(1);
    } else {
      console.log(chalk.green(`\n[PASS] Dead files count (${deadFiles}) is within limit (${maxDead}).`));
      process.exit(0);
    }
  });

program
  .command('explain <filePath>')
  .description('Explain why a file is dead or trace its reachability')
  .option('-p, --project <path>', 'Path to project root', '.')
  .action((filePath, options) => {
    const projectPath = path.resolve(options.project);
    const targetAbsPath = path.resolve(projectPath, filePath);

    if (!fs.existsSync(targetAbsPath)) {
      console.error(chalk.red(`File not found: ${filePath}`));
      process.exit(1);
    }

    const analyzer = new DeadCodeAnalyzer({ projectPath });
    const report = analyzer.analyze();
    const graph = analyzer.graph;

    const fileReport = report.files.find(f => path.resolve(f.path) === targetAbsPath);
    if (!fileReport) {
      console.error(chalk.red(`File is not part of the analyzed project source files.`));
      process.exit(1);
    }

    const relPath = path.relative(projectPath, targetAbsPath);
    console.log(`\n[${fileReport.status} FILE] ${chalk.blue(relPath)}`);
    console.log(`Status: ${fileReport.status}`);
    console.log(`Confidence: ${fileReport.confidence}\n`);

    if (fileReport.status === 'ALIVE') {
      console.log(chalk.bold('Traceability Graph Analysis:'));
      if (fileReport.tracePath && fileReport.tracePath.length > 0) {
        console.log(`  ✓ Entry Point: ${chalk.green(path.relative(projectPath, fileReport.tracePath[0]))}`);
        for (let i = 1; i < fileReport.tracePath.length; i++) {
          const connector = i === fileReport.tracePath.length - 1 ? '└─►' : '├─►';
          const node = fileReport.tracePath[i];
          const isSymbol = node.includes('#');
          const cleanPath = node.split('#')[0];
          const symbolPart = isSymbol ? ` (${node.split('#')[1]})` : '';
          console.log(`  ${connector} ${path.relative(projectPath, cleanPath)}${symbolPart} (Alive)`);
        }
      } else {
        console.log(`  ✓ Entry Point: This file is itself an entry point.`);
      }
    } else {
      console.log(chalk.bold('Traceability Graph Analysis:'));
      const entries = resolveEntries(projectPath);
      if (entries.length > 0) {
        const relEntry = path.relative(projectPath, entries[0]);
        console.log(`  ✗ Entry Point: ${relEntry}`);
      } else {
        console.log(`  ✗ Entry Point: (No entry point resolved)`);
      }

      // Find why it is dead: trace backward
      const fileNodeId = `file:///${targetAbsPath.replace(/\\/g, '/')}`;
      const aliveNodeIds = graph.computeReachability().aliveNodeIds;
      const deadRefs = getDeadIncomingChain(fileNodeId, graph);

      if (deadRefs.length > 0) {
        console.log(`  └─x (No reachable edge from alive nodes)`);
        console.log(`\nImported/Referenced by:`);
        const printed = new Set<string>();
        for (const ref of deadRefs) {
          if (printed.has(ref)) continue;
          printed.add(ref);

          const isSymbol = ref.includes('#');
          const refFile = ref.split('#')[0].replace('file:///', '');
          if (refFile === targetAbsPath) continue;

          const relRefFile = path.relative(projectPath, refFile);
          const isAlive = aliveNodeIds.has(ref);
          const statusText = isAlive ? chalk.green('ALIVE') : chalk.red('DEAD');

          if (isSymbol) {
            const symName = ref.split('#')[1];
            console.log(`  └─ ${chalk.gray(relRefFile)} (Symbol '${chalk.yellow(symName)}' is ${statusText})`);
          } else {
            console.log(`  └─ ${chalk.gray(relRefFile)} (${statusText})`);
          }
        }
      } else {
        console.log(`  └─x (No reachable edge to ${path.basename(targetAbsPath)})`);
      }

      console.log(`\nReasons:`);
      fileReport.reasons?.forEach((reason, index) => {
        console.log(`  ${index + 1}. ${reason}`);
      });
    }
  });

function getDeadIncomingChain(nodeId: string, graph: BiDirectionalGraph, visited = new Set<string>()): string[] {
  if (visited.has(nodeId)) return [];
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

  // Also check if any symbol in the target file has incoming edges
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

program
  .command('prune')
  .description('Prune dead files and unused static assets')
  .option('-p, --project <path>', 'Path to project root', '.')
  .option('--dry-run', 'Print files that would be pruned without actually pruning', false)
  .option('--force', 'Delete files permanently without backup', false)
  .option('--backup-dir <dir>', 'Specify the backup directory name', '.deadfinder-backup')
  .action((options) => {
    const projectPath = path.resolve(options.project);
    if (!fs.existsSync(projectPath)) {
      console.error(chalk.red(`Project path does not exist: ${options.project}`));
      process.exit(1);
    }

    const analyzer = new DeadCodeAnalyzer({ projectPath });
    const report = analyzer.analyze();

    const deadFilesToPrune = report.files.filter(f => f.status === 'DEAD' && f.confidence === 'HIGH');
    
    const unusedAssetsToPrune: string[] = [];
    report.files.forEach(f => {
      if (f.unusedAssets) {
        f.unusedAssets.forEach(asset => {
          unusedAssetsToPrune.push(asset);
        });
      }
    });

    if (deadFilesToPrune.length === 0 && unusedAssetsToPrune.length === 0) {
      console.log(chalk.green('\nNo dead files or unused static assets found to prune!'));
      process.exit(0);
    }

    console.log(chalk.bold.yellow('\nPruning candidate files:'));
    deadFilesToPrune.forEach(f => {
      const rel = path.relative(projectPath, f.path);
      console.log(`  📄 [File]   ${chalk.red(rel)}`);
    });
    unusedAssetsToPrune.forEach(asset => {
      const rel = path.relative(projectPath, asset);
      console.log(`  🖼️  [Asset]  ${chalk.red(rel)}`);
    });

    if (options.dryRun) {
      console.log(chalk.cyan(`\n[Dry Run] Total ${deadFilesToPrune.length} files and ${unusedAssetsToPrune.length} assets would be pruned.`));
      process.exit(0);
    }

    const isBackup = !options.force;
    const backupDir = path.resolve(projectPath, options.backupDir);

    if (isBackup) {
      fs.mkdirSync(backupDir, { recursive: true });
      console.log(chalk.cyan(`\nBacking up files to: ${chalk.bold(backupDir)}`));
    }

    let prunedFilesCount = 0;
    let prunedAssetsCount = 0;

    deadFilesToPrune.forEach(f => {
      const absPath = path.resolve(f.path);
      if (fs.existsSync(absPath)) {
        if (isBackup) {
          const relPath = path.relative(projectPath, absPath);
          const backupDest = path.join(backupDir, relPath);
          fs.mkdirSync(path.dirname(backupDest), { recursive: true });
          fs.renameSync(absPath, backupDest);
        } else {
          fs.rmSync(absPath, { force: true });
        }
        prunedFilesCount++;
      }
    });

    unusedAssetsToPrune.forEach(asset => {
      const absPath = path.resolve(asset);
      if (fs.existsSync(absPath)) {
        if (isBackup) {
          const relPath = path.relative(projectPath, absPath);
          const backupDest = path.join(backupDir, relPath);
          fs.mkdirSync(path.dirname(backupDest), { recursive: true });
          fs.renameSync(absPath, backupDest);
        } else {
          fs.rmSync(absPath, { force: true });
        }
        prunedAssetsCount++;
      }
    });

    console.log(chalk.bold.green(`\nSuccessfully pruned ${prunedFilesCount} files and ${prunedAssetsCount} static assets!`));
    if (isBackup) {
      console.log(chalk.green(`Pruned files are backed up at: ${backupDir}`));
    }
  });

program.parse(process.argv);
export { program };
