const fs=require('fs');
let s=fs.readFileSync('src/app.html','utf8');
const css=fs.readFileSync('node_modules/leaflet/dist/leaflet.css','utf8').replace(/url\(images\/([\w-]+\.png)\)/g,(m,f)=>`url(data:image/png;base64,${fs.readFileSync('node_modules/leaflet/dist/images/'+f).toString('base64')})`);
const js=fs.readFileSync('node_modules/leaflet/dist/leaflet.js','utf8');
s=s.replace('/*LEAFLET_CSS*/',()=>css).replace('/*LEAFLET_JS*/',()=>js).replace('/*REVERSE_JS*/',()=>fs.readFileSync('src/reverse.js','utf8'));
fs.writeFileSync('index.html',s);fs.mkdirSync('vendor',{recursive:true});fs.copyFileSync('node_modules/jspdf/dist/jspdf.umd.min.js','vendor/jspdf.umd.min.js');
for (const f of ['pdf.min.js','pdf.worker.min.js']) fs.copyFileSync('node_modules/pdfjs-dist/build/'+f,'vendor/'+f); // PDF pages -> images for the reverse roadbook reader
console.log('ok',s.length);
