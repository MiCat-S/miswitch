// Numerical contrast of actual CSS token pairs. Disabled controls and decorative SVG glyphs excluded.
const fs=require('node:fs');
const css=fs.readFileSync('src/ui/styles.css','utf8');
const themes=[['light',css.slice(css.indexOf(':root {'),css.indexOf('@media (prefers-color-scheme: dark)'))],['dark',css.slice(css.indexOf('@media (prefers-color-scheme: dark)'),css.indexOf('* { box-sizing'))]];
const rgb=h=>{const n=h.replace('#','');return(n.length===3?n.split('').map(x=>x+x).join(''):n).match(/../g).map(x=>parseInt(x,16));};
const lum=a=>a.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((x,y)=>y-x);return (x+.05)/(y+.05);};
for(const [theme,part]of themes){
 const tokens=Object.fromEntries([...part.matchAll(/--([\w-]+):\s*(#[0-9a-f]+)\s*;/g)].map(x=>[x[1],rgb(x[2])]));
 const pairs=[['secondary','sidebar'],['secondary','panel-2'],['secondary','window'],['on-accent','accent'],['warn-text','warn-soft'],['danger','danger-soft']];
 console.log(JSON.stringify({theme,ratios:pairs.map(([fg,bg])=>({fg,bg,ratio:+contrast(tokens[fg],tokens[bg]).toFixed(3)}))}));
 for(const hue of ['sky','mineral','plum','clay','stone']){
  const mix=(a,b,n)=>a.map((x,i)=>x*n+b[i]*(1-n));
  const foreground=mix(tokens[hue],tokens.ink,.8), background=mix(tokens[hue],tokens.panel,.16);
  console.log(JSON.stringify({theme,letterHue:hue,ratio:+contrast(foreground,background).toFixed(3)}));
 }
}
console.log(JSON.stringify({declaredFontSizes:[...new Set([...css.matchAll(/font-size:\s*(\d+)px/g)].map(x=>+x[1]))].sort((a,b)=>a-b),note:'14/15 are also used for letter initials; 18/20 include icon-only rules'}));
console.log(JSON.stringify({fontSizesIncludingShorthand:[...new Set([...css.matchAll(/font-size:\s*(\d+)px|font:\s*[^;]*?\b(\d+)px/g)].map(x=>+(x[1]||x[2])))].sort((a,b)=>a-b)}));
