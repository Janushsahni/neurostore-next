import fs from 'fs';
let code = fs.readFileSync('s:/neurostore-next/neurostore-next/frontend/src/pages/DriveDashboard.jsx', 'utf8');

code = code.replace(/let response;\s*if \(DEMO_MODE\) \{\s*response = await demoApiRequest\('\/user-drive'\);\s*\} else \{\s*response = await fetch\([^;]*?\);\s*\}/s, $const response = await fetch(\$${S3_GATEWAY_URL}/$${BUCKET_NAME}\, { headers: getAuthHeaders() }););

code = code.replace(/if \(DEMO_MODE\) \{[\s\S]*?demoAddFile\(file\);\s*return;\s*\}/, '');

code = code.replace(/if \(DEMO_MODE\) \{[\s\S]*?toast\.success\(Downloaded "$${fileName}", \{ icon: '??' \}\);\s*\}\s*return;\s*\}/, '');

code = code.replace(/if \(DEMO_MODE\) \{[\s\S]*?fetchFiles\(\);\s*return;\s*\}/, '');

code = code.replace(/let res;\s*if \(DEMO_MODE\) \{[\s\S]*?\} else \{\s*res = await fetch\([^;]*?\);\s*\}/, $const res = await fetch(\$${S3_GATEWAY_URL}/api/object/rename/$${BUCKET_NAME}/$${encodeKey(fileName)}\, { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ new_key: newKey.trim() }) }););

fs.writeFileSync('s:/neurostore-next/neurostore-next/frontend/src/pages/DriveDashboard.jsx', code);
console.log('Replaced successfully!');
