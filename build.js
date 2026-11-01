const fs=require('fs');
let s=fs.readFileSync('src/app.html','utf8');
const css=fs.readFileSync('node_modules/leaflet/dist/leaflet.css','utf8').replace(/url\(images\/([\w-]+\.png)\)/g,(m,f)=>`url(data:image/png;base64,${fs.readFileSync('node_modules/leaflet/dist/images/'+f).toString('base64')})`);
const js=fs.readFileSync('node_modules/leaflet/dist/leaflet.js','utf8');
s=s.replace('/*LEAFLET_CSS*/',()=>css).replace('/*LEAFLET_JS*/',()=>js);
fs.writeFileSync('index.html',s);
console.log('ok',s.length);
