#!/usr/bin/env bun
import { extractVanillaWebRoutes } from './src/extractors/routes/vanilla-web.js';

console.log('🧪 Testing link discovery...\n');

const result = await extractVanillaWebRoutes({
  rootDir: '/tmp/test-vanilla-web',
});

console.log('📄 File-based routes:');
result.routes
  .filter(r => r.source === 'file-based')
  .forEach(route => {
    console.log(`  ${route.path}`);
  });

console.log('\n🔗 Link-discovered routes:');
result.routes
  .filter(r => r.source === 'link-discovered')
  .forEach(route => {
    console.log(`  ${route.path} (found in ${route.filePath.split('/').pop()})`);
  });

console.log('\n📊 Summary:');
console.log(`  Total: ${result.routes.length}`);
console.log(`  File-based: ${result.routes.filter(r => r.source === 'file-based').length}`);
console.log(`  Link-discovered: ${result.routes.filter(r => r.source === 'link-discovered').length}`);
