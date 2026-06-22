<!-- SPDX-License-Identifier: Apache-2.0 -->

# Five-Tier IC Glyph: Authoring Specification

A complete build spec for "glyphs": self-contained, single-file interactive HTML visualizations that teach one integrated circuit by showing it at five levels of zoom, all sharing the chip's real physical package. Built for the CEC teaching game. The reference implementation is the 74LVC1G04 inverter (`inv-ic.html`, shipped alongside this doc). This document gives an agent everything needed to build the same artifact for any other logic gate (NAND, NOR, AND, OR, XOR, buffer) or general IC.

The reference file `inv-ic.html` is the canonical, working template. Read it next to this spec. Everything marked "verbatim infrastructure" below is copied from it unchanged for every new gate; everything marked "gate-specific" is what you author per part.

---

## 0. The one idea

Every tier draws the identical real package frame with the real pinout, and only the internals change. Tier 1 is the most abstract (logic symbol), tier 5 is the most physical (silicon cross-section), and all five route their internal nodes out to the same physical pins. A learner flips between tiers and the pins never move, so the abstraction and the silicon stay anchored to the same pads. This is the property that makes the set cohere and the reason the package frame is a shared helper (`drawPkg`) rather than redrawn per tier.

## 1. The five tiers (fixed meaning, fixed order)

1. **symbol**: the logic symbol (gate body + output bubble for inverting gates) wired to the real pinout. Includes a truth table.
2. **flow**: the whole gate as a hydraulic flow network. A supply tank (VCC) fills an output chamber through a pull-up path and a drain (GND) empties it through a pull-down path, both piloted by the inputs. This is the "overall analogy."
3. **valves**: the same pull-up and pull-down opened up as pressure-pilot valves, the working MOSFET analogy. A sealed gate line sets a spring-loaded plug; plug lift equals gate overdrive; flow chokes at the throat when the device saturates. This is the transistor-level analogy.
4. **device**: the real package drawn to scale with the CMOS transistor network as a schematic (pull-up network over pull-down network, gates tied to inputs). This is the "real device."
5. **silicon**: the metal-oxide cross-section of that transistor network on one die (wells, n+/p+ diffusions, gate oxide and metal, inversion channels, carriers). This is the physical reality.

Tiers 2 and 3 are analogies; tiers 4 and 5 are real. The bridge: tiers 3, 4, and 5 are all driven by the same device model, so the valve lift, the schematic channel opacity, and the silicon inversion layer all move off one computed solution. Tiers 1 and 2 read the same model state at a coarser (logic / open-shut) level.

**The tiers are two zoom pairs plus the silicon.** Tier 4 is a *zoom-in of tier 1* (the symbol opened up into the full device it stands for), and tier 3 is a *zoom-in of tier 2* (the overall flow analogy opened up into its working parts). So the **real track** runs 1 -> 4 and the **analogy track** runs 2 -> 3, with tier 5 the physical silicon. Build each pair so the deeper tier is literally the shallower one magnified: same part, same pins, more detail.

**Show all of it, down to the FETs, and carry the analogy all the way down.** A learner is meant to zoom in and literally see every component working, so do not abstract devices away to save space (the completeness is the point; the file is made to be zoomed). Crucially, the **analogy does not stop at the function level** -- in the analogy track every component, down to each individual FET, has an analogy form: tier 3 is the **FET-level analogy** (each transistor a pressure-pilot valve), so the zoomed-in analogy is the full mechanism at the transistor level, not a high-level cartoon. For a part too large to draw every transistor (a multi-gate composite, a register-transfer FSM), decompose to its natural component level (gates, flip-flops, registers) and let each of those carry its own FET-level valve analogy; never leave an opaque block that cannot be opened.

## 2. Hard constraints (do not violate)

- Single self-contained `.html` file. No external JS or CSS except the one Google Fonts `<link>`. No build step. Never use `localStorage`, `sessionStorage`, or any browser storage.
- Output text is ASCII only for punctuation. No em dash, no en dash, no arrows, no smart quotes, no unicode minus (U+2212). Use a spaced period " . " or a comma as a separator inside labels (for example `VCC . pin 5`). ASCII hyphen is allowed only inside compound words and ranges (`pull-up`, `SOT-23-5`) and as a charge sign (`+` and `-`). This applies to every SVG label and every prose string, and to this kind of authoring prose too.
- Scene SVG is `viewBox="0 0 780 540"`. Transfer-curve scope SVG is `viewBox="0 0 300 210"`.
- Palette is OKLCH deep violet. Fonts: Saira (body), Saira Condensed (display), IBM Plex Mono (mono). Do not substitute.
- Verify every datasheet fact (pinout, package, supply range, logic equation). Do not recall pinouts from memory. Pull the part datasheet and cite the package drawing for pin order.

## 3. File anatomy (top to bottom)

```
<head>
  fonts <link>
  <style>  ... full house-style CSS (verbatim infrastructure, section 4)
<body>
  .wrap
    .hud-header   brand + two status chips (gate type, region)
    h1.lede       one-line title
    p.intro       prose describing all five tiers (gate-specific)
    .modebar      five tier buttons (data-t = t1..t5)
    .main
      .board-frame   #scene  (the 780x540 SVG, all tiers live here)
      .side          #telemetry panel + #scope transfer-curve SVG
    .transport    sliders (vin, vdd, vt) + pause button
    footer        #footnote prose (gate-specific)
<script> (IIFE)
  NS + helpers el/lerp/clamp/poly/vcoil/flowDots/th/mix   (verbatim)
  palette constants + wcol                                 (verbatim)
  defs (glow filter)                                       (verbatim)
  model: KP/LAMBDA/imos + model(...) + fmtV/fmtI           (gate-specific model, verbatim formatters)
  gT1..gT5 groups created and appended                     (verbatim)
  PKX/PKY constants + drawPkg(g)                           (verbatim infra; pin map is gate-specific)
  var t1={}; buildT1(); updateT1();   ... through t5       (gate-specific tier code)
  mosfet(...) schematic helper                             (verbatim, used by device tier)
  buildT1();buildT2();buildT3();buildT4();buildT5();        <-- MUST sit after every tier defn
  buildScope/buildGrid/drawScope + buildScope()            (verbatim)
  telemetry rows                                           (verbatim)
  controls + setTier + frame loop                          (verbatim; names map + chip text gate-specific)
```

Two ordering rules that cause silent breakage if violated:
- Every `var tN={}` and every `buildTN`/`updateTN` and `drawPkg` must be defined before the `buildT1();...buildT5();` call line. Function declarations hoist, but the `var tN={}` object assignments do not, so a tier object created after the build call throws "Cannot set properties of undefined".
- `buildScope()` is called after the tier build call. The scope reads `model(...)`, which is already defined above, so this is safe.

---

## 4. House style (verbatim infrastructure)

### 4.1 Fonts (in `<head>`)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Saira:wght@400;500;600&family=Saira+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

### 4.2 CSS (copy whole, unchanged)

```css
:root{
  --bg: oklch(0.135 0.022 285); --bg-2: oklch(0.165 0.028 285);
  --surface: oklch(0.205 0.034 285); --surface-2: oklch(0.245 0.04 285);
  --border: oklch(0.32 0.045 285); --border-bright: oklch(0.42 0.06 285);
  --faint: oklch(0.55 0.025 285); --dim: oklch(0.74 0.02 285); --text: oklch(0.97 0.004 285);
  --accent: oklch(0.64 0.255 350); --accent-line: color-mix(in oklch, var(--accent) 42%, transparent);
  --accent-soft: color-mix(in oklch, var(--accent) 16%, transparent);
  --violet: oklch(0.62 0.2 292); --cyan: oklch(0.82 0.13 215); --bronze: oklch(0.74 0.085 72);
  --ok: oklch(0.8 0.17 150); --warn: oklch(0.78 0.16 75); --bad: oklch(0.6 0.24 25);
  --font-body:"Saira",system-ui,sans-serif; --font-display:"Saira Condensed","Arial Narrow",sans-serif; --font-mono:"IBM Plex Mono",ui-monospace,monospace;
  color-scheme:dark; color:var(--text); background:var(--bg); font-family:var(--font-body); font-size:16px; line-height:1.5; -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
}
*{box-sizing:border-box;}
body{margin:0; min-height:100svh;
  background: radial-gradient(120% 80% at 50% -10%, color-mix(in oklch, var(--violet) 12%, transparent), transparent 60%),
    linear-gradient(to right, oklch(0.5 0.05 285 / 0.05) 1px, transparent 1px),
    linear-gradient(to bottom, oklch(0.5 0.05 285 / 0.05) 1px, transparent 1px), var(--bg);
  background-size: 100% 100%, 34px 34px, 34px 34px;}
.wrap{max-width:1180px; margin:0 auto; padding:0 16px 40px;}
.hud-header{display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 6px; border-bottom:1px solid var(--border); margin-bottom:16px;}
.brand{display:flex; align-items:center; gap:12px;}
.brand-mark{display:grid; place-items:center; width:30px; height:30px; color:var(--accent); border:1px solid var(--accent-line); border-radius:3px; box-shadow:0 0 0 1px var(--accent-soft), 0 0 18px -4px var(--accent); font-family:var(--font-mono); font-weight:600; font-size:15px;}
.brand-text{font-family:var(--font-display); font-weight:700; font-size:20px; letter-spacing:0.14em; text-transform:uppercase;}
.brand-sub{margin-left:8px; color:var(--accent); font-weight:500;}
.header-meta{display:flex; align-items:center; gap:8px;}
.chip{font-family:var(--font-mono); font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--dim); padding:4px 9px; border:1px solid var(--border); border-radius:2px; background:var(--surface); white-space:nowrap;}
.chip-accent{color:var(--accent); border-color:var(--accent-line);}
h1.lede{font-family:var(--font-display); font-weight:600; font-size:25px; margin:0 0 6px;}
p.intro{color:var(--dim); font-size:14.5px; margin:0 0 16px; max-width:94ch;} p.intro b{color:var(--text);}
.modebar{display:flex; flex-wrap:wrap; gap:10px 18px; align-items:center; margin-bottom:14px;}
.seg{display:inline-flex; border:1px solid var(--border-bright); border-radius:4px; overflow:hidden;}
.seg button{font-family:var(--font-display); font-size:12.5px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:var(--dim); background:var(--surface); border:none; padding:8px 14px; cursor:pointer; transition:background .15s,color .15s;}
.seg button + button{border-left:1px solid var(--border);}
.seg button.on{color:var(--text); background:var(--surface-2); box-shadow:inset 0 -2px 0 var(--accent);}
.seg-label{font-family:var(--font-mono); font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:var(--faint); margin-right:2px;}
.main{display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:16px; align-items:start;}
.board-frame{position:relative; border:1px solid var(--border-bright); border-radius:4px; overflow:hidden; background:linear-gradient(180deg,var(--bg-2),var(--bg)); box-shadow:inset 0 0 0 1px oklch(0 0 0 / 0.4), inset 0 0 60px -20px oklch(0 0 0 / 0.8);}
.board-frame svg{display:block; width:100%; height:auto;}
.scope-tag{position:absolute; top:10px; left:12px; font-family:var(--font-mono); font-size:10px; letter-spacing:0.18em; text-transform:uppercase; color:var(--faint); background:oklch(0.135 0.022 285 / 0.6); padding:3px 7px; border:1px solid var(--border); border-radius:2px;}
.scope-tag.r{left:auto; right:12px;}
.side{display:flex; flex-direction:column; gap:16px;}
.panel{border:1px solid var(--border); border-radius:4px; background:linear-gradient(180deg,var(--bg-2),var(--bg)); overflow:hidden;}
.panel-title{margin:0; padding:12px 14px 10px; font-family:var(--font-display); font-weight:600; font-size:12px; letter-spacing:0.2em; text-transform:uppercase; color:var(--dim); border-bottom:1px solid var(--border);}
.panel-body{padding:12px 14px;}
.ro{display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 0;}
.ro + .ro{border-top:1px solid var(--border);}
.ro-k{font-size:12px; letter-spacing:0.04em; text-transform:uppercase; color:var(--faint);}
.ro-v{font-family:var(--font-mono); font-size:13px; color:var(--text);}
.scopewrap{padding:8px 10px 12px;}
.scopewrap svg{display:block; width:100%; height:auto;}
.transport{margin-top:16px; border:1px solid var(--border); border-radius:4px; background:linear-gradient(0deg,var(--bg-2),transparent); padding:12px 14px; display:flex; flex-wrap:wrap; gap:16px 22px; align-items:center;}
.tg{display:flex; align-items:center; gap:9px;}
.btn{font-family:var(--font-display); font-size:13px; font-weight:600; letter-spacing:0.12em; text-transform:uppercase; color:var(--text); padding:8px 14px; border:1px solid var(--border-bright); border-radius:3px; background:var(--surface); cursor:pointer; transition:border-color .15s, background .15s, box-shadow .15s, color .15s;}
.btn:hover{background:var(--surface-2); border-color:var(--dim);}
.btn-ghost{font-family:var(--font-mono); letter-spacing:0.08em; padding:7px 11px; color:var(--dim); font-size:12px; text-transform:uppercase;}
.btn-ghost.is-active{color:var(--accent); border-color:var(--accent-line); background:var(--accent-soft);}
.in-ctl{display:flex; flex-direction:column; gap:5px; min-width:200px;}
.in-ctl .ic-top{display:flex; justify-content:space-between; align-items:baseline;}
.ic-name{font-family:var(--font-mono); font-size:11px; letter-spacing:0.08em; color:var(--c,var(--dim));}
.ic-val{font-family:var(--font-mono); font-size:11px; color:var(--text);}
input[type=range]{-webkit-appearance:none; appearance:none; width:100%; height:20px; background:transparent; cursor:pointer; margin:0;}
input[type=range]:focus{outline:none;}
input[type=range]::-webkit-slider-runnable-track{height:4px; background:var(--surface-2); border-radius:2px;}
input[type=range]::-moz-range-track{height:4px; background:var(--surface-2); border-radius:2px;}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none; appearance:none; width:15px; height:15px; border-radius:50%; background:var(--cyan); border:2px solid var(--bg); box-shadow:0 0 10px -2px var(--cyan); margin-top:-6px;}
input[type=range]::-moz-range-thumb{width:15px; height:15px; border-radius:50%; background:var(--cyan); border:2px solid var(--bg); box-shadow:0 0 10px -2px var(--cyan);}
input[type=range].ta::-webkit-slider-thumb{background:var(--accent); box-shadow:0 0 10px -2px var(--accent);}
input[type=range].ta::-moz-range-thumb{background:var(--accent);}
input[type=range].tb::-webkit-slider-thumb{background:var(--bronze); box-shadow:0 0 10px -2px var(--bronze);}
input[type=range].tb::-moz-range-thumb{background:var(--bronze);}
footer{margin-top:20px; padding-top:16px; border-top:1px solid var(--border); font-size:12.5px; color:var(--faint); line-height:1.6;} footer b{color:var(--dim);}
@media (max-width:900px){ .main{grid-template-columns:1fr;} }
```

### 4.3 Body shell (copy structure; the four marked strings are gate-specific)

```html
<body>
<div class="wrap">
  <div class="hud-header">
    <div class="brand"><div class="brand-mark">CE</div><div class="brand-text">Critical Error<span class="brand-sub">logic gate study</span></div></div>
    <div class="header-meta"><span class="chip chip-accent" id="chipType">NOT</span><span class="chip" id="chipReg">PULL-UP</span></div>
  </div>

  <h1 class="lede">The NOT gate, five layers down</h1>            <!-- GATE-SPECIFIC lede -->
  <p class="intro">...describe all five tiers for this gate...</p> <!-- GATE-SPECIFIC intro -->

  <div class="modebar">
    <span class="seg-label">view</span>
    <div class="seg" id="tierSeg">
      <button data-t="t1" class="on">1 &middot; symbol</button>
      <button data-t="t2">2 &middot; flow</button>
      <button data-t="t3">3 &middot; valves</button>
      <button data-t="t4">4 &middot; device</button>
      <button data-t="t5">5 &middot; silicon</button>
    </div>
  </div>

  <div class="main">
    <div class="board-frame">
      <span class="scope-tag" id="visTag">schematic</span>
      <span class="scope-tag r" id="regTag">pull-up</span>
      <svg id="scene" viewBox="0 0 780 540" xmlns="http://www.w3.org/2000/svg" aria-label="logic gate"></svg>
    </div>
    <div class="side">
      <div class="panel"><h2 class="panel-title">Operating point</h2><div class="panel-body" id="telemetry"></div></div>
      <div class="panel"><h2 class="panel-title">Transfer curve</h2><div class="scopewrap"><svg id="scope" viewBox="0 0 300 210" xmlns="http://www.w3.org/2000/svg"></svg></div></div>
    </div>
  </div>

  <div class="transport">
    <div class="in-ctl" style="--c:var(--accent)"><div class="ic-top"><span class="ic-name">input V_in</span><span class="ic-val" id="labVin">0.00 V</span></div><input type="range" class="ta" id="vin" min="0" max="600" value="0"></div>
    <div class="in-ctl" style="--c:var(--cyan)"><div class="ic-top"><span class="ic-name">supply V_DD</span><span class="ic-val" id="labVdd">5.00 V</span></div><input type="range" id="vdd" min="200" max="600" value="500"></div>
    <div class="in-ctl" style="--c:var(--bronze)"><div class="ic-top"><span class="ic-name">threshold V_t</span><span class="ic-val" id="labVt">1.00 V</span></div><input type="range" class="tb" id="vt" min="50" max="200" value="100"></div>
    <div class="tg"><button class="btn btn-ghost is-active" id="btnRun">pause</button></div>
  </div>

  <footer id="footnote"></footer>     <!-- GATE-SPECIFIC footnote set in JS -->
</div>
<script>
(function(){
  var svg=document.getElementById('scene');
```

Sliders carry integers and the JS divides by 100, so `vin 0..600` means 0.00 to 6.00 V, `vdd 200..600` means 2.00 to 6.00 V, `vt 50..200` means 0.50 to 2.00 V. For a multi-input gate you add one input slider per input (see section 9, the NAND example) and give each its own id; keep `vdd` and `vt` as is.

---

## 5. Helper library (verbatim infrastructure)

Paste these once at the top of the IIFE. They are gate-agnostic and every tier depends on them.

```js
var NS='http://www.w3.org/2000/svg';
function el(t,a,txt){var e=document.createElementNS(NS,t);if(a){for(var k in a){e.setAttribute(k,a[k]);}}if(txt!=null){e.textContent=txt;}return e;}
function lerp(a,b,t){return a+(b-a)*t;}
function clamp(v,lo,hi){return v<lo?lo:(v>hi?hi:v);}
function poly(arr){return arr.map(function(p){return p[0]+','+p[1];}).join(' ');}
function vcoil(cx,ya,yb,amp,coils){var n=Math.max(2,Math.round(coils*8)),d='';for(var k=0;k<=n;k++){var t=k/n,y=lerp(ya,yb,t),x=cx+Math.sin(t*coils*Math.PI*2)*amp;d+=(k===0?'M ':'L ')+x.toFixed(1)+' '+y.toFixed(1)+' ';}return d;}
function flowDots(run,dots,path,len,norm,col,fwd){var on=(norm>0.02),sp=(0.2+norm*0.95);for(var i=0;i<dots.length;i++){var o=dots[i];if(run&&on){o.u=(o.u+sp*0.004)%1;}var uu=fwd?o.u:(1-o.u),pt=path.getPointAtLength(uu*len);o.el.setAttribute('cx',pt.x.toFixed(1));o.el.setAttribute('cy',pt.y.toFixed(1));o.el.setAttribute('opacity',(on?clamp(0.35+norm,0,1):0).toFixed(2));o.el.setAttribute('fill',col);}}
function th(i){return (i*0.61803398875)%1;}
function mix(c1,c2,t){function h(c){return [parseInt(c.substr(1,2),16),parseInt(c.substr(3,2),16),parseInt(c.substr(5,2),16)];}var a=h(c1),b=h(c2);return 'rgb('+Math.round(lerp(a[0],b[0],t))+','+Math.round(lerp(a[1],b[1],t))+','+Math.round(lerp(a[2],b[2],t))+')';}

var CYAN='#46d2e6',WARM='#ffe6c0',WATER='#46b6f0',WATER2='#7fd0ff',ORANGE='#ff9a4d',DIM='#b6b0c6',FAINT='#80798f',ACCENT='#ff5c8a',STEEL='#9aa6bd',OK='#7ad6a0',BRONZE='#d6a866',ELEC='#5fd0ff',OXIDE='#caa46a',HOLE='#ff7a59',LO='#566076',HI='#5fd0ff';
function wcol(v,VDD){return mix(LO,HI,clamp(v/VDD,0,1));}

var defs=el('defs',{});
var f1=el('filter',{id:'glow',x:'-80%',y:'-80%',width:'260%',height:'260%'});f1.appendChild(el('feGaussianBlur',{stdDeviation:'3.2'}));defs.appendChild(f1);
svg.appendChild(defs);
```

What each does, since you will lean on them constantly:
- `el(tag, attrs, text)` builds an SVG element. This is how every shape is made. `mix` only accepts `#rrggbb` hex, not `oklch()` strings, so keep the named hex constants for anything you pass through `mix` or `wcol`.
- `wcol(v, VDD)` maps a node voltage to a wire color from `LO` (slate, logic 0) to `HI` (cyan, logic 1). Use it for every signal wire so color tracks voltage.
- `flowDots(run, dots, path, len, norm, col, fwd)` animates a ring of dots along an invisible `<path>`. `run` is the global play flag, `norm` in [0,1] is flow rate (0 hides them), `fwd` reverses direction. Each dot is `{el, u}` where `u` is its position fraction. Build the path with `fill:'none', stroke:'none'`, read `path.getTotalLength()` once, store it.
- `th(i)` is a golden-ratio stagger so a batch of dots have de-correlated thresholds (used so dots fade in unevenly rather than all at once).
- `vcoil(cx, ya, yb, amp, coils)` returns a vertical zig-zag path string for a spring (used by the valve tier gate spring). Compresses as `yb-ya` shrinks.
- The `glow` filter is referenced as `filter:'url(#glow)'` on lit channels and the operating-point dot.

## 6. The device model (gate-specific, with verbatim scaffolding)

The model is the physics core. It takes the input voltage(s), the supply, and the threshold, and returns node voltages, per-transistor overdrive and region, and the logic levels. Tiers 3, 4, 5 read its per-transistor numbers; tiers 1, 2 read its logic and region. The transfer-curve scope samples it across the input sweep.

### 6.1 Square-law transistor (verbatim)

```js
var KP=0.5, LAMBDA=0.02;
function imos(von,vds){if(von<=0)return 0;if(vds<0)vds=0;if(vds<von)return KP*(von*vds-0.5*vds*vds);return 0.5*KP*von*von*(1+LAMBDA*(vds-von));}
```

`imos(overdrive, vds)` is a normalized n-channel drain current: zero when off (`von<=0`), triode when `vds<von`, saturation otherwise. It is unitless. The through-current readout is therefore correct in shape but not in absolute amperes (a real 74LVC1G04 quiescent ICC is around 10 uA, per the TI datasheet); the glyph normalizes it for display. State this caveat in handbacks.

### 6.2 The inverter model (the reference; replace this for a new gate)

```js
function model(Vin,VDD,Vt){
  Vin=clamp(Vin,0,VDD);
  var vonN=Vin-Vt, vonP=(VDD-Vin)-Vt;
  var lo=0,hi=VDD,Vout=VDD/2;
  for(var it=0;it<42;it++){var mid=(lo+hi)/2,In=imos(vonN,mid),Ip=imos(vonP,VDD-mid);if(In>Ip){hi=mid;}else{lo=mid;}Vout=mid;}
  var In=imos(vonN,Vout),Ip=imos(vonP,VDD-Vout),Ithru=(In+Ip)/2;
  var region=(vonN>0&&vonP>0)?'switching':((vonP>0&&vonN<=0)?'pull-up':((vonN>0&&vonP<=0)?'pull-down':'floating'));
  return {Vin:Vin,Vout:Vout,vonN:vonN,vonP:vonP,Ithru:Ithru,region:region,lIn:(Vin>VDD/2)?1:0,lOut:(Vout>VDD/2)?1:0,VDD:VDD};
}
function fmtV(v){return v.toFixed(2)+' V';}
function fmtI(I){var a=Math.abs(I);if(a<1e-7)return '0';if(a<1e-3)return (I*1e6).toFixed(1)+' uA';if(a<1)return (I*1000).toFixed(2)+' mA';return I.toFixed(2)+' A';}
```

How it works: `vonN = Vin - Vt` is the NMOS overdrive (NMOS turns on when input is high); `vonP = (VDD - Vin) - Vt` is the PMOS overdrive (PMOS turns on when input is low). The 42-iteration bisection finds `Vout` where the NMOS current pulling down equals the PMOS current pulling up. `region` is the four-way operating state. `fmtV`/`fmtI` are verbatim formatters.

### 6.3 Writing the model for a different gate

The gate is a pull-up network (PUN, p-channel devices to VCC) and a pull-down network (PDN, n-channel devices to GND), and they are complementary. For any static CMOS gate:

- PDN: n-channel devices. A series chain pulls down only when all its inputs are high (this is AND on the inputs). Parallel n-channel devices pull down when any input is high (OR).
- PUN: p-channel devices, the dual. Parallel p-channel pulls up when any input is low; series p-channel pulls up when all inputs are low.
- Output is low exactly when the PDN conducts; high exactly when the PUN conducts.

Per device, compute its own overdrive:
- n-channel at input `Vi`: `von = Vi - Vt`, and its `vds` is the voltage across that device in the conducting path (for a single-device PDN it is `Vout`; for a series chain, approximate by sharing `Vout` across the stacked devices or, simplest, drive the stage off the weakest (smallest) overdrive in the series chain).
- p-channel at input `Vi`: `von = (VDD - Vi) - Vt`, `vds = VDD - Vout` for a single device.

For the output node, keep the same current-balance bisection but sum the conducting network currents on each side. The simplest faithful approach for a two-input gate: compute an effective pull-up overdrive and an effective pull-down overdrive from the network rule, then reuse the inverter bisection with those effective overdrives. Return one record that still carries `Vout, region, lIn, lOut, VDD` plus the per-device overdrives the tiers need (name them so the tier code can read them, for example `vonN_a, vonN_b, vonP_a, vonP_b`).

`region` generalizes to: `switching` when both networks partly conduct, otherwise `pull-up` / `pull-down` / `floating`. `lOut` is computed from `Vout` against `VDD/2`. For multi-input gates `lIn` becomes per-input logic bits.

Keep the model pure (no DOM, no globals beyond `KP/LAMBDA/imos`) so the scope can call it 80 times per redraw to plot the transfer curve.

---

## 7. The shared package frame (the core abstraction)

### 7.1 `drawPkg` (reference: SOT-23-5, inverter pin map)

Define `gT1..gT5` first, then the frame constants and `drawPkg`. Every tier calls `drawPkg(gTn)` as its first build step.

```js
var gT1=el('g',{}),gT2=el('g',{}),gT3=el('g',{}),gT4=el('g',{}),gT5=el('g',{});
svg.appendChild(gT1);svg.appendChild(gT2);svg.appendChild(gT3);svg.appendChild(gT4);svg.appendChild(gT5);

var PKX0=190,PKX1=590,PKY0=116,PKY1=456;
function drawPkg(g){
  g.appendChild(el('rect',{x:PKX0,y:PKY0,width:PKX1-PKX0,height:PKY1-PKY0,rx:11,fill:'oklch(0.135 0.02 285)',stroke:STEEL,'stroke-width':2}));
  g.appendChild(el('circle',{cx:PKX0+20,cy:PKY1-18,r:5,fill:'none',stroke:DIM,'stroke-width':1.4}));   // pin-1 orientation dot
  function pin(x,top,num,name,col){
    var ty=top?PKY0-28:PKY1;
    g.appendChild(el('rect',{x:x-7,y:ty,width:14,height:28,rx:2,fill:'oklch(0.3 0.02 285)',stroke:STEEL,'stroke-width':1}));            // metal tab
    g.appendChild(el('text',{x:x,y:top?PKY0+15:PKY1-7,'font-family':'var(--font-mono)','font-size':10,fill:FAINT,'text-anchor':'middle'},num));   // pin number, inside body
    g.appendChild(el('text',{x:x,y:top?ty-7:ty+41,'font-family':'var(--font-mono)','font-size':12,fill:col,'text-anchor':'middle'},name));        // function name, outside tab
  }
  pin(280,true,'5','VCC',HI); pin(500,true,'4','Y',DIM);
  pin(280,false,'1','NC',FAINT); pin(390,false,'2','A',ACCENT); pin(500,false,'3','GND',LO);
  g.appendChild(el('line',{x1:280,y1:PKY1,x2:280,y2:PKY1-20,stroke:'#4a5266','stroke-width':2}));         // NC no-connect stub
  g.appendChild(el('circle',{cx:280,cy:PKY1-22,r:3.4,fill:'none',stroke:'#4a5266','stroke-width':1.4}));
}
```

The body is `190..590` wide by `116..456` tall (400 by 340), centered at x=390. The internal usable area is roughly x `200..580`, y `126..446`. Top pins stick up from `PKY0`, bottom pins stick down from `PKY1`. The pin number sits just inside the body edge, the function name outside the tab.

### 7.2 Connection points (the contract every tier honors)

`pin(x, top, ...)` fixes where a tier's internal run must terminate. For the inverter SOT-23-5 map these are:

| pin | function | x | edge y | connection point |
|----|---------|----|--------|------------------|
| 5  | VCC     | 280 | top    | (280, PKY0=116) |
| 4  | Y (out) | 500 | top    | (500, PKY0=116) |
| 1  | NC      | 280 | bottom | stub only       |
| 2  | A (in)  | 390 | bottom | (390, PKY1=456) |
| 3  | GND     | 500 | bottom | (500, PKY1=456) |

Top pins are the natural home for the top-of-die contacts (supply, output). Bottom pins (inputs, ground) route up into the body. Whatever the tier draws inside, its supply run ends at (280,116), its output run ends at (500,116), its input run ends at (390,456), its ground run ends at (500,456).

### 7.3 Adapting `drawPkg` to a different package or pinout

The frame and `drawPkg` stay; you change three things.

1. Confirm the real pinout from the datasheet package drawing. Note which physical pins are inputs, output(s), VCC, GND, NC.
2. Replace the `pin(...)` calls so the numbers, names, and x positions match the real part. Keep the rule that a top pin sits at the same x as the bottom pin directly below it where the package has them aligned (true SOT-23-5 puts pin 5 above pin 1 and pin 4 above pin 3, which is why VCC is above NC and Y is above GND here). Spread the pins across the body width with comfortable spacing (here: 280 / 390 / 500 on each edge).
3. Re-point the per-tier runs to the new connection points. The simplest way to keep tier code readable is to define a small lookup right after `drawPkg`, for example `var PIN={vcc:[280,PKY0], y:[500,PKY0], a:[390,PKY1], gnd:[500,PKY1]};` and have every tier read from it instead of hardcoding. Add `b:[...]` for a second input, etc.

For larger packages (SOIC-8, SOIC-14, more pins per edge) keep the same body rectangle but add more `pin(...)` calls along each edge, spacing them evenly (`PKX0 + (i+0.5)*(PKX1-PKX0)/perEdge`). The body can be widened by lowering `PKX0` and raising `PKX1` if you need more internal room, but the left margin (x `0..PKX0`) holds the legend and the right margin (x `PKX1..780`) holds the live output voltage, so do not consume those entirely.

### 7.4 Schematic transistor symbol `mosfet` (verbatim, used by the device tier)

```js
function mosfet(group,gx,topY,botY,nodeY,isP){
  var g={isP:isP};
  var GX=gx, CX=gx+22, TY=topY, BY=botY;
  g.GX=GX;g.CX=CX;g.TY=TY;g.BY=BY;
  group.appendChild(el('line',{x1:GX,y1:TY+8,x2:GX,y2:BY-8,stroke:STEEL,'stroke-width':3.2}));        // gate plate
  var segs=[[TY+8,TY+30],[TY+34,BY-34],[BY-30,BY-8]];
  segs.forEach(function(sgmt){group.appendChild(el('line',{x1:CX,y1:sgmt[0],x2:CX,y2:sgmt[1],stroke:STEEL,'stroke-width':3.6}));}); // broken channel
  g.chan=el('line',{x1:CX,y1:TY+8,x2:CX,y2:BY-8,stroke:OK,'stroke-width':4.5,'stroke-linecap':'round',opacity:0,filter:'url(#glow)'});group.appendChild(g.chan); // induced channel (lights when on)
  group.appendChild(el('path',{d:'M '+CX+' '+(TY+18)+' L '+(CX+26)+' '+(TY+18)+' L '+(CX+26)+' '+TY,fill:'none',stroke:STEEL,'stroke-width':2.4}));   // top terminal
  group.appendChild(el('path',{d:'M '+CX+' '+(BY-18)+' L '+(CX+26)+' '+(BY-18)+' L '+(CX+26)+' '+BY,fill:'none',stroke:STEEL,'stroke-width':2.4}));   // bottom terminal
  g.topx=CX+26;g.botx=CX+26;
  group.appendChild(el('line',{x1:GX,y1:(TY+BY)/2,x2:GX-30,y2:(TY+BY)/2,stroke:STEEL,'stroke-width':2.4})); // gate lead left
  g.gateLeadX=GX-30;g.gateY=(TY+BY)/2;
  if(isP){g.bub=el('circle',{cx:GX-6,cy:(TY+BY)/2,r:5,fill:'var(--bg-2)',stroke:STEEL,'stroke-width':1.4});group.appendChild(g.bub);} // PMOS gate bubble
  g.label=el('text',{x:CX+30,y:(TY+BY)/2+4,'font-family':'var(--font-mono)','font-size':12,fill:DIM},isP?'PMOS':'NMOS');group.appendChild(g.label);
  return g;
}
```

A vertical MOSFET symbol. Gate plate at `gx`, channel at `gx+22`, both terminals at `gx+48` (right side), gate lead out to `gx-30`. Returns the geometry you wire to: `topx`/`botx` (terminals), `gateLeadX`/`gateY` (gate connection), `chan` (the element whose opacity you raise when the device turns on), `bub` (PMOS only). For a multi-transistor gate, call `mosfet` once per device and place them as a vertical stack (series) or side by side (parallel) per the network.

---

## 8. The five tiers in detail

General rules for every tier:
- First line of `buildTN` is `drawPkg(gTn)`.
- Put the tier title and legend in the LEFT margin (x ~30 to 40, y ~150 to 220). Put the live state label in the left margin around y 300. Put the live output voltage in the RIGHT margin near the Y connection point (x ~508).
- Signal wires use `wcol(v, VDD)`; supply runs use `HI` at reduced opacity; ground runs use `LO`. Input/pilot runs use `ACCENT` (dashed for sealed pilot lines in the flow and valve tiers).
- Each `updateTN(s)` receives the model record `s` (with `s.run` for the play flag) and only sets attributes; it never creates elements.
- Members read in `updateTN` must be created as `tN.member = ...` in `buildTN`. The validation harness checks this (section 11).

### 8.1 Tier 1, symbol

Concept: the gate logic symbol wired to the real pinout, plus a truth table and a plain-language state note. For the inverter, a right-pointing triangle with an output bubble.

Inverter layout (verbatim constants): triangle base (input) at `bx=352` from y `244..328`, apex (output) at `apex=452`, vertical center `my=286`, bubble at `apex+11`. Runs:
- input A: `M 390 PKY1 L 390 410 L 314 410 L 314 my L bx my` (up from A pin, around the lower-left, into the triangle base).
- output Y: `M apex+21 my L 500 my L 500 PKY0` (from the bubble, right then up to Y).
- VCC taps the triangle upper edge at x=405 (compute the edge y by interpolation), GND taps the lower edge at x=405, both drawn thin at opacity 0.8 with `HI`/`LO`.
- logic digits `0`/`1` near the input and output (`x` 334 and 498, `y` my-12).
- truth table in the left margin at `TX=40, TY=252`, one highlighted row per input combination.

`updateT1(s)`: recolor input wire by `wcol(Vin)`, output wire and bubble and triangle by `wcol(Vout)`, set the logic digits from `s.lIn`/`s.lOut`, highlight the truth row where the input matches `s.lIn`, set the note to "low in, high out" / "high in, low out" / "crossing over" (when `region==='switching'`).

Generalize: swap the symbol shape (AND is a D-shape, OR/XOR are curved-back shields, add the output bubble for NAND/NOR/XNOR). Add one input run per input, each from its pin around to the correct symbol input. Expand the truth table to 2^n rows and highlight the active one from the per-input logic bits.

### 8.2 Tier 2, flow network

Concept: the whole gate as plumbing. A supply tank (VCC) at the top feeds an output chamber through the pull-up path; the chamber drains to a reservoir (GND) through the pull-down path. The chamber fill level is the output voltage. The input is a sealed pilot that opens one valve and shuts the other and carries no flow itself. Valves here are simple (chamber, seat, lifting plug); the detailed mechanism is tier 3.

Inverter layout (verbatim constants): central column `CX=400`. Supply tank y `150..180`, pull-up valve throat `PUy=226`, output chamber y `262..316` (`CHT`/`CHB`, store on `t2`), pull-down valve throat `PDy=352`, drain reservoir y `394..424`. Local helpers:

```js
function mkv2(cx,cy){ /* chamber rect + two seat triangles + lifting plug ellipse, all appended to gT2; returns {cx,cy,plug,...} */ }
function setv2(g,open){ var lift=clamp(open,0,1)*12; g.plug.setAttribute('cy',(g.cy-lift).toFixed(1)); g.plug.setAttribute('fill', open>0.05?'#c7cfdd':'#aeb6c4'); }
```

Runs and animation:
- VCC pin to supply tank: `M 280 PKY0 L 280 165 L CX-44 165`.
- GND pin to drain: `M 500 PKY1 L 500 411 L CX+44 411`.
- chamber to Y pin: `M CX+30 288 L 500 288 L 500 PKY0`.
- A pin to both valves as a dashed sealed pilot bus (`ACCENT`, dash `4 3`, opacity ~0.6): up from A, across to a left bus x ~330, then stubs to each valve body.
- fill flow path (VCC down through the pull-up plug into the chamber) and drain flow path (chamber down through the pull-down plug to the drain), each an invisible path with a `Q` curve that bows around the plug; animate with `flowDots`. Fill rate is gated by the pull-up open amount and stops when the chamber is full; drain rate by the pull-down open amount, stops when empty.
- chamber fill level: a `<rect>` (`t2.level`) grown from the chamber bottom, `height = clamp(Vout/VDD,0,1)*(CHB-CHT-6)`.

`updateT2(s)`: `openP=clamp(vonP/VDD*2,0,1)`, `openN=clamp(vonN/VDD*2,0,1)`; drive `setv2` for each; set fill level; recolor the chamber-to-Y wire by `wcol(Vout)`; run fill and drain flowDots; set state label ("pull-up open, fills to VCC" / "pull-down open, drains to GND" / "both valves cracked" / "both shut").

Generalize: the pull-up and pull-down become networks of valves. Series valves (an AND in the pull-down) are stacked in the same drain pipe and the path is choked unless all are open; parallel valves (an OR) are two pipes into the chamber. The supply, chamber, drain, and the chamber-to-Y run are unchanged. One sealed pilot bus per input, each to the valves it drives.

### 8.3 Tier 3, pressure-pilot valves

Concept: the same two valves, opened up as the working MOSFET analogy. A sealed gate cylinder (no flow through it) holds a spring-loaded plug against a seat. Gate pressure (the input, via the sealed bus) pushes a piston whose rod lifts the plug; lift equals gate overdrive against the spring (the spring constant is the threshold V_t). When the device saturates, the flow chokes at the throat. Stacked pull-up (PMOS) over pull-down (NMOS).

Inverter layout (verbatim constants):
```js
var T3PCX=414, T3WL=392, T3WR=436, PT_Y=206, NT_Y=372, T3OUTY=289;
var VRy0=150, VRy1=176, GRy0=400, GRy1=426, T3GCX=324, ovRange=2.0, maxLift=26;
```
`t3valve(throatY, ctY, cbY, yA, yB)` draws: two seat ridges (apex at `T3PCX +/- 10`), a 12-dot flow ring, the plug ellipse (rx 11), the gate cylinder rect (`T3GCX +/- 20`, y `ctY..cbY`), a bronze `vcoil` spring, a piston rect, and a horizontal rod from the cylinder to the plug. It returns the handles used by `t3set`. `t3set(g, vov, vds, run)` does:
- `lift = clamp(max(vov,0),0,ovRange)/ovRange*maxLift`; set plug `cy`, piston `y`, rod `y`, and the spring path (`vcoil(g.GCX, g.CT, plugY-5, 4, 4)`).
- region from overdrive and `vds`: `cutoff` / `triode` / `saturation`.
- flow dots route around the plug: at each dot's y, the channel half-width is `wall - throatNarrow(y) ` minus a plug bulge, so dots squeeze through the gap; at saturation the throat narrows further (choke) and the seats turn bronze.
- returns the region string.

Totem and runs:
- pull-up valve `t3valve(PT_Y, 174, 232, VRy1, T3OUTY)` between the VCC reservoir (top) and the OUT node.
- pull-down valve `t3valve(NT_Y, 340, 398, T3OUTY, GRy0)` between the OUT node and the GND reservoir (bottom).
- VCC reservoir (top) fed from `M 280 PKY0 L 280 163 L T3PCX-38 163`; GND reservoir (bottom) fed from `M 500 PKY1 L 500 413 L T3PCX+38 413`.
- OUT node at `(T3PCX, T3OUTY)` to Y pin: `M T3PCX T3OUTY L 500 T3OUTY L 500 PKY0`.
- A pin to both gate cylinders as a dashed sealed gate bus (`ACCENT`), left bus at x ~270, stubs to each cylinder bottom.
- labels "pull-up PMOS / opens low in", "pull-down NMOS / opens high in", "spring=V_t" on each cylinder, "choked" shown on a valve in saturation.

`updateT3(s)`: `pReg=t3set(t3.pu, s.vonP, VDD-Vout, s.run)`, `nReg=t3set(t3.pd, s.vonN, Vout, s.run)`; recolor OUT-to-Y wire by `wcol(Vout)`; toggle the per-valve "choked" labels on saturation; set state label.

Generalize: one valve per transistor, arranged as the network (series valves stacked in line, parallel valves side by side feeding a common node). Each valve's `t3set` is driven by that device's overdrive and its `vds`. Keep the gate bus per input.

### 8.4 Tier 4, real device (package plus CMOS schematic)

Concept: the real package at scale with the transistor network drawn as a schematic. Pull-up network box over pull-down network box, transistors via `mosfet`, gates tied to the input, shoot-through dots at the crossover.

Inverter layout (verbatim constants): `gx=378, termx=gx+48 (426)`, `VCCy=178, OUTy=295, GNDy=410`.
- VCC rail from `M 280 PKY0 L 280 VCCy` then a horizontal rail to `termx`; GND rail from `M 500 PKY1 L 500 GNDy` then a horizontal rail to `termx`.
- pull-up box and pull-down box (rounded rects around each device, ~x 344..444).
- `t4.p=mosfet(gT4,gx,196,260,OUTy,true)` (PMOS), `t4.n=mosfet(gT4,gx,330,394,OUTy,false)` (NMOS).
- wires: PMOS source (termx,196) up to VCC rail; PMOS drain (termx,260) down to OUT (termx,OUTy); NMOS drain (termx,330) up to OUT; NMOS source (termx,394) down to GND rail.
- OUT to Y: `M termx OUTy L 500 OUTy L 500 PKY0`.
- input A to both gates: from A pin up to a gate bus at x ~336, vertical between `t4.p.gateY` and `t4.n.gateY`, stubs out to each `gateLeadX`.
- two invisible flow paths (charge: VCC down through PMOS to OUT; discharge: OUT down through NMOS to GND) animated with `flowDots`.

`updateT4(s)`: raise `t4.p.chan` opacity by `clamp(vonP/VDD*2.2,0,1)`, `t4.n.chan` by `clamp(vonN/VDD*2.2,0,1)`; set channel color WARM at `switching` else OK; light the box strokes when their device is on; recolor OUT wires by `wcol(Vout)`; recolor gate wires by `wcol(Vin)`; run charge/discharge flowDots gated by overdrive and whether the output still has room to move; set state label ("PMOS on, pin 4 (Y) tied to VCC" / "NMOS on, pin 4 (Y) tied to GND" / "both on briefly, shoot-through current" / "both off, output floating").

Generalize: place one `mosfet` per device. Series devices share a column (drain of one to source of the next); parallel devices sit side by side with drains joined. The PUN sits between VCC and OUT, the PDN between OUT and GND. Gates of devices driven by the same input share that input's bus.

### 8.5 Tier 5, silicon (metal-oxide cross-section)

Concept: the cross-section of the transistor network on one die. p-type substrate, an n-well for the p-channel devices, n+/p+ diffusions for sources and drains, gate oxide and gate metal, inversion channels that form under the gate, and carriers moving source to drain (electrons for n-channel, holes for p-channel). Charge sits on the gate but never crosses the oxide.

Inverter layout (verbatim constants): `SUBX=210, SUBR=570, SURF=306, SUBB=440, NWX0=206, NWX1=392`. PMOS on the LEFT (in the n-well, near VCC at top-left), NMOS on the RIGHT (in the substrate, near GND at bottom-right). This left/right choice keeps the source wiring to VCC-left and GND-right clean; it is flipped from the textbook NMOS-left convention, which is a deliberate, flaggable choice.
- PMOS (left): p+ source x 222..278 (to VCC), gate x 286..348 with oxide + metal stack above the surface, p+ drain x 354..390 (to Y). Hole channel (`t5.pChan`) tapers and pinches at the drain in saturation; hole carriers (HOLE color) run source to drain on an invisible `t5.pPath`; four `-` gate charges fade in with input low.
- NMOS (right): n+ drain x 404..438 (to Y), gate x 446..504, n+ source x 514..558 (to GND). Electron channel (`t5.nChan`), electron carriers (ELEC) on `t5.nPath`, four `+` gate charges fade in with input high.
- interconnect: VCC pin to PMOS source `M 280 PKY0 L 280 266 L 250 266 L 250 SURF`; the two drains up to a center Y bus then to Y `M 372 252 L 422 252 L 500 252 L 500 PKY0`; A pin up the center to both gates (this wire crosses the Y bus with no junction dot, which is the standard "crossing, not connected" schematic convention and is acceptable); GND pin up the right side to the NMOS source.
- labels p+ / n+ / source / drain / gate / n-well / p-type substrate / PMOS pull-up / NMOS pull-down.

`updateT5(s)`: build each channel polygon from its device overdrive and `vds` (the drain end pinches when `overdrive - vds < 0`, i.e. saturation); set channel opacity on/off; fade gate charges by input level; run carrier dots gated by overdrive; recolor the Y bus by `wcol(Vout)`; set state label.

Generalize: one source/gate/drain triplet per device, placed in the well that matches its channel type (p-channel in n-well, n-channel in substrate). Shared nodes (a series connection) become a shared diffusion between two gates. Keep p-channel devices grouped near the VCC side and n-channel near the GND side so the interconnect stays readable.

---

## 9. Scope, telemetry, controls, frame loop (verbatim infrastructure)

This is the chrome around the scene. The build call for the tiers must come before the scope build.

```js
buildT1();buildT2();buildT3();buildT4();buildT5();

var scope=document.getElementById('scope');var sc={};
function buildScope(){
  var L=42,R=288,T=14,B=176;sc.L=L;sc.R=R;sc.T=T;sc.B=B;
  scope.appendChild(el('rect',{x:L,y:T,width:R-L,height:B-T,fill:'oklch(0.16 0.02 285)',stroke:'oklch(0.32 0.045 285)','stroke-width':1}));
  sc.grid=el('g',{});scope.appendChild(sc.grid);
  scope.appendChild(el('text',{x:(L+R)/2,y:B+26,'font-family':'var(--font-mono)','font-size':9,fill:DIM,'text-anchor':'middle'},'V_in'));
  scope.appendChild(el('text',{x:13,y:(T+B)/2,'font-family':'var(--font-mono)','font-size':9,fill:DIM,'text-anchor':'middle','transform':'rotate(-90 13 '+((T+B)/2)+')'},'V_out'));
  sc.curThru=el('path',{d:'',fill:'none',stroke:'oklch(0.6 0.12 72)','stroke-width':1.4,opacity:0.7});scope.appendChild(sc.curThru);
  sc.curve=el('path',{d:'',fill:'none',stroke:ACCENT,'stroke-width':2.2,'stroke-linejoin':'round'});scope.appendChild(sc.curve);
  sc.diag=el('line',{x1:0,y1:0,x2:0,y2:0,stroke:'oklch(0.4 0.03 285)','stroke-width':1,'stroke-dasharray':'2 3'});scope.appendChild(sc.diag);
  sc.cx=el('line',{x1:0,y1:0,x2:0,y2:0,stroke:CYAN,'stroke-width':1,'stroke-dasharray':'3 3',opacity:0.5});scope.appendChild(sc.cx);
  sc.cy=el('line',{x1:0,y1:0,x2:0,y2:0,stroke:CYAN,'stroke-width':1,'stroke-dasharray':'3 3',opacity:0.5});scope.appendChild(sc.cy);
  sc.op=el('circle',{cx:L,cy:T,r:4,fill:CYAN,filter:'url(#glow)'});scope.appendChild(sc.op);
  scope.appendChild(el('text',{x:R-2,y:T+12,'font-family':'var(--font-mono)','font-size':8,fill:'oklch(0.6 0.12 72)','text-anchor':'end'},'I through'));
  sc.lastVDD=-1;sc.lastVt=-1;
}
function buildGrid(VDD){
  while(sc.grid.firstChild)sc.grid.removeChild(sc.grid.firstChild);
  var L=sc.L,R=sc.R,T=sc.T,B=sc.B;
  for(var k=0;k<=VDD+0.001;k++){var x=L+(k/VDD)*(R-L),y=B-(k/VDD)*(B-T);
    sc.grid.appendChild(el('line',{x1:x,y1:T,x2:x,y2:B,stroke:'oklch(0.22 0.02 285)','stroke-width':1}));
    sc.grid.appendChild(el('line',{x1:L,y1:y,x2:R,y2:y,stroke:'oklch(0.22 0.02 285)','stroke-width':1}));}
  sc.grid.appendChild(el('line',{x1:L,y1:B,x2:R,y2:B,stroke:FAINT,'stroke-width':1.3}));
  sc.grid.appendChild(el('line',{x1:L,y1:T,x2:L,y2:B,stroke:FAINT,'stroke-width':1.3}));
}
function drawScope(s){
  var L=sc.L,R=sc.R,T=sc.T,B=sc.B,VDD=s.VDD;
  function X(vin){return L+clamp(vin/VDD,0,1)*(R-L);}
  function Y(vout){return B-clamp(vout/VDD,0,1)*(B-T);}
  if(VDD!==sc.lastVDD||s.Vt!==sc.lastVt){
    buildGrid(VDD);
    var d='',dt='',ipk=1e-9;
    var samp=[];
    for(var k=0;k<=80;k++){var vin=k/80*VDD,m=model(vin,VDD,s.Vt);samp.push(m);if(m.Ithru>ipk)ipk=m.Ithru;}
    for(k=0;k<=80;k++){var vin2=k/80*VDD,m2=samp[k];d+=(k===0?'M ':'L ')+X(vin2).toFixed(1)+' '+Y(m2.Vout).toFixed(1)+' ';
      var yt=B-(m2.Ithru/ipk)*(B-T)*0.9;dt+=(k===0?'M ':'L ')+X(vin2).toFixed(1)+' '+yt.toFixed(1)+' ';}
    sc.curve.setAttribute('d',d);sc.curThru.setAttribute('d',dt);
    sc.lastVDD=VDD;sc.lastVt=s.Vt;
  }
  var ox=X(s.Vin),oy=Y(s.Vout);
  sc.op.setAttribute('cx',ox.toFixed(1));sc.op.setAttribute('cy',oy.toFixed(1));
  sc.cx.setAttribute('x1',L);sc.cx.setAttribute('y1',oy);sc.cx.setAttribute('x2',ox);sc.cx.setAttribute('y2',oy);
  sc.cy.setAttribute('x1',ox);sc.cy.setAttribute('y1',B);sc.cy.setAttribute('x2',ox);sc.cy.setAttribute('y2',oy);
}
buildScope();

var tele=document.getElementById('telemetry');
function trow(k){var w=document.createElement('div');w.className='ro';var a=document.createElement('span');a.className='ro-k';a.textContent=k;var b=document.createElement('span');b.className='ro-v';w.appendChild(a);w.appendChild(b);tele.appendChild(w);return b;}
var roVin=trow('input V_in'),roVout=trow('output V_out'),roLogic=trow('logic in / out'),roI=trow('through-current'),roS=trow('state');

var vinEl=document.getElementById('vin'),vddEl=document.getElementById('vdd'),vtEl=document.getElementById('vt'),
    labVin=document.getElementById('labVin'),labVdd=document.getElementById('labVdd'),labVt=document.getElementById('labVt'),
    btnRun=document.getElementById('btnRun'),visTag=document.getElementById('visTag'),regTag=document.getElementById('regTag'),
    chipReg=document.getElementById('chipReg'),footnote=document.getElementById('footnote');
var running=true,tier='t1';
footnote.innerHTML='...gate-specific footnote prose...';

function setTier(t){tier=t;gT1.style.display=(t==='t1')?'':'none';gT2.style.display=(t==='t2')?'':'none';gT3.style.display=(t==='t3')?'':'none';gT4.style.display=(t==='t4')?'':'none';gT5.style.display=(t==='t5')?'':'none';
  var names={t1:'logic symbol',t2:'flow network',t3:'pressure pilot valves',t4:'real device . 74LVC1G04',t5:'metal oxide silicon'};visTag.textContent=names[t];
  [].forEach.call(document.querySelectorAll('#tierSeg button'),function(b){b.classList.toggle('on',b.getAttribute('data-t')===t);});}
[].forEach.call(document.querySelectorAll('#tierSeg button'),function(b){b.addEventListener('click',function(){setTier(b.getAttribute('data-t'));});});
btnRun.addEventListener('click',function(){running=!running;this.textContent=running?'pause':'run';this.classList.toggle('is-active',running);});
setTier('t1');

var tick=0;
function frame(){
  if(running){tick++;}
  var VDD=(+vddEl.value)/100, Vt=(+vtEl.value)/100, Vin=clamp((+vinEl.value)/100,0,VDD);
  var m=model(Vin,VDD,Vt);var s={Vin:m.Vin,Vout:m.Vout,vonN:m.vonN,vonP:m.vonP,Ithru:m.Ithru,region:m.region,lIn:m.lIn,lOut:m.lOut,VDD:VDD,Vt:Vt,run:running,tick:tick};
  if(tier==='t1'){updateT1(s);}else if(tier==='t2'){updateT2(s);}else if(tier==='t3'){updateT3(s);}else if(tier==='t4'){updateT4(s);}else{updateT5(s);}
  drawScope(s);
  labVin.textContent=fmtV(Vin);labVdd.textContent=fmtV(VDD);labVt.textContent=fmtV(Vt);
  roVin.textContent=fmtV(Vin);roVout.textContent=fmtV(m.Vout);roLogic.textContent=m.lIn+'  /  '+m.lOut;roLogic.style.color=HI;
  roI.textContent=fmtI(m.Ithru);roI.style.color=(m.region==='switching')?WARM:DIM;
  roS.textContent=m.region;roS.style.color=(m.region==='switching')?WARM:((m.region==='floating')?FAINT:OK);
  regTag.textContent=m.region;chipReg.textContent=m.region.toUpperCase();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
```

What is gate-specific in this block:
- `names` map values (the tag shown over the scene per tier) and the `t4` value naming the part.
- `footnote.innerHTML` and the intro paragraph.
- `chipType` text (set in HTML) and the region wording if your gate has different states.
- For multiple inputs: add `vinBEl=...`, read it in `frame`, pass both into `model`, and pack the per-input bits into `s`. The scope X axis sweeps one chosen input while holding the others; pick the input that produces the most informative transfer curve (for NAND, hold one input high and sweep the other, so the curve looks like an inverter; note this on the scope).

The transfer-curve scope is the proof that the step and the shoot-through spike are computed, not drawn: it resamples `model` 80 times whenever VDD or Vt changes and plots Vout and the normalized through-current against the swept input, with a live operating-point dot.

---

## 10. Validation gates (run all before delivering)

Set `GLYPH=yourfile.html`. Run from the file's directory. All must pass.

1. JS syntax. Extract the script and run Node's checker.
```bash
awk '/<script>/{f=1;next}/<\/script>/{f=0}f' "$GLYPH" > /tmp/s.js && node --check /tmp/s.js && echo "syntax OK"
```
During incremental edits the extractor may catch a partial script; filter the spurious tail with `2>&1 | grep -v "end of input"`.

2. Forbidden glyphs. Check the actual unicode code points, not byte patterns. The `$'\uXXXX'` form in `grep` does not expand on every shell (it can silently match the literal text `u2014` instead of the em dash), so use python, which is authoritative. This also catches the HTML entities `&mdash;` and `&ndash;` as text.
```bash
python3 - "$GLYPH" << 'PY'
import sys
src=open(sys.argv[1],encoding='utf-8').read()
forbid={'\u2014':'em-dash','\u2013':'en-dash','\u2192':'arrow-r','\u2190':'arrow-l','\u2212':'minus','\u2018':'quote','\u2019':'quote','\u201c':'quote','\u201d':'quote'}
cp={name:src.count(ch) for ch,name in forbid.items() if ch in src}
ent=sum(src.count(e) for e in ('&mdash;','&ndash;'))
print('forbidden code points:', cp or 'none')
print('html dash entities:', ent)
PY
```
Both lines must report `none` and `0`. (A spaced multiplication sign or other typographic unicode that creeps in from pasted datasheet text is easy to miss, so run this on the final file, not a draft.)

3. Structure counts.
```bash
grep -c "drawPkg(gT" "$GLYPH"     # must equal 5 (one frame per tier)
grep -c "var t4=" "$GLYPH"        # must equal 1 (catches a tier object swallowed or duplicated by a splice)
```

4. Member consistency. For each tier, every `tN.member` read in `updateTN` must be created as `tN.member =` in `buildTN`. This catches the most common runtime crash (reading an attribute off `undefined`).
```bash
python3 - "$GLYPH" << 'PY'
import re,sys
src=open(sys.argv[1]).read()
def body(fn):
    m=re.search(r'function '+fn+r'\s*\([^)]*\)\s*\{',src)
    if not m: return None
    i=m.end();d=1;o=[]
    while i<len(src) and d>0:
        c=src[i];d+=(c=='{')-(c=='}')
        if d>0:o.append(c)
        i+=1
    return ''.join(o)
for o,bf,uf in [('t1','buildT1','updateT1'),('t2','buildT2','updateT2'),('t3','buildT3','updateT3'),('t4','buildT4','updateT4'),('t5','buildT5','updateT5')]:
    B=body(bf);U=body(uf)
    if B is None or U is None: print('['+o+'] MISSING'); continue
    cr=set(re.findall(r'\b'+o+r'\.([A-Za-z_]\w*)\s*=',B)); us=set(re.findall(r'\b'+o+r'\.([A-Za-z_]\w*)',U))
    print('['+o+']', sorted(us-cr) or 'clean')
PY
```

5. Render and screenshot with Playwright (chromium). Load `file://`, click each tier, set sliders by dispatching `input`, toggle the pause button, collect console errors and page errors (expect none), and capture the `.board-frame`. Sweep every tier across vin/vdd/vt extremes; view each screenshot and fix any collision or off-canvas label. Skeleton:
```bash
node -e '
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 980 }, deviceScaleFactor: 2 });
  const errs=[]; p.on("pageerror",e=>errs.push(e.message)); p.on("console",m=>{if(m.type()==="error")errs.push(m.text());});
  await p.goto("file://'"$PWD"'/'"$GLYPH"'");
  const frame = await p.$(".board-frame");
  const setV=(id,val)=>p.evaluate(([i,v])=>{const e=document.getElementById(i);e.value=v;e.dispatchEvent(new Event("input"));},[id,val]);
  for(const t of ["t1","t2","t3","t4","t5"]){ await p.click("[data-t="+t+"]");
    for(const vdd of [200,350,600]){ await setV("vdd",vdd);
      for(const vt of [50,120,200]){ await setV("vt",vt);
        for(let v=0;v<=600;v+=100){ await setV("vin",v); await p.waitForTimeout(2); } } } }
  await setV("vdd",500);await setV("vt",100);
  await p.click("[data-t=t3]");await setV("vin",600);await p.waitForTimeout(700);await frame.screenshot({path:"shot_t3.png"});
  console.log("errors:",errs.length?errs:"none");
  await b.close();
})();'
```
Capture at least the three operating points per tier: a clean low input, a clean high input, and the switching midpoint (around vin = vdd/2 + vt). Animated states need a ~700 ms settle before the screenshot.

`node --check` does not catch undefined-at-runtime references, so step 5 (an actual render with the error listener) is mandatory, not optional.

## 11. Build method and pitfalls

- Write the file with `create_file` for the shell, then build each tier's code in a temp file and splice it in with a small Python script that finds unique comment markers (`// ============ TIER N : ...`) and replaces between them. `create_file` can fail silently on very large `file_text`, so prefer per-tier splices over one giant write.
- Splice pitfall: replacing a tier block can swallow an adjacent top-level declaration or a helper that lived between two markers. This happened twice while building the reference: `var t4={};` was lost replacing the T3..T4 region, and the `mosfet` helper was lost replacing the old T2 block, which threw "mosfet is not defined" at runtime. After every splice, grep to confirm the top-level `var tN={}`, the build call line, and every shared helper (`mosfet`, `drawPkg`) still exist, then re-render to catch runtime ReferenceErrors.
- Order pitfall: a `var tN={}` placed after the `buildT1();...buildT5();` call throws "Cannot set properties of undefined". Keep all tier blocks and `drawPkg` above the build call.
- Keep a checkpoint copy of the last good build before a large restructure.

## 12. Recipe for a new gate (checklist)

1. Pull the datasheet. Record the exact part number, package, supply range, the logic equation, and the real pinout from the package drawing. Decide the slider set (one `vin` per input, plus `vdd`, `vt`).
2. Copy the reference `inv-ic.html` as the skeleton. Keep all verbatim infrastructure (CSS, helpers, scope, telemetry, controls, frame loop).
3. Edit `drawPkg`: set the `pin(...)` calls to the real pin numbers, names, and x positions; keep alignment (a top pin above the bottom pin the package places below it); add a `PIN` lookup. Update the `chipType` text and the `names` map and the part name in `t4`.
4. Write `model`: build the PUN and PDN per the logic, compute per-device overdrive and the output node by current balance, return `Vout, region, lIn/lOut (or per-input bits), VDD`, and the named per-device overdrives the tiers read. Verify the transfer curve by eye in the scope.
5. Rebuild each tier in order, reusing the patterns in section 8, re-pointing every internal run to the new connection points. After each, run gate 1 (syntax) and gate 4 (member consistency), then render that tier.
6. Write the intro and footnote prose for this gate (describe all five tiers; tie the valve and silicon tiers back to the same computed solution).
7. Run all validation gates (section 10). View every screenshot. Fix collisions.
8. Flag in the handback any compactness tradeoffs, any schematic crossings without junctions, any left/right device-placement choice that differs from textbook, and the normalized (not absolute) through-current scale.

---

## 13. Worked example: generalizing to a 2-input NAND (SN74LVC1G00)

Real data, verified from the TI datasheet (SCES212AB, document at ti.com/lit/ds/symlink/sn74lvc1g00.pdf). Single 2-input positive NAND, Y = NOT(A AND B), 1.65 V to 5.5 V, SOT-23-5 (DBV). Pin functions for the DBV package:

| pin | function | notes |
|----|----------|-------|
| 1  | A   | input |
| 2  | B   | input |
| 3  | GND | ground |
| 4  | Y   | output |
| 5  | VCC | power |

So relative to the 1G04 inverter (pin 1 = NC, pin 2 = A), the NAND fills pin 1 (the inverter's no-connect) with input A and uses pin 2 for input B. There is no NC pin. Physical SOT-23-5 placement keeps pin 5 above pin 1 and pin 4 above pin 3, so on the frame: VCC top-left over A bottom-left, Y top-right over GND bottom-right, B at bottom-center.

### 13.1 `drawPkg` change

```js
pin(280,true,'5','VCC',HI); pin(500,true,'4','Y',DIM);
pin(280,false,'1','A',ACCENT); pin(390,false,'2','B',ACCENT); pin(500,false,'3','GND',LO);
// drop the NC stub and dot (all five pins are used)
var PIN={vcc:[280,PKY0], y:[500,PKY0], a:[280,PKY1], b:[390,PKY1], gnd:[500,PKY1]};
```

### 13.2 Model change (two inputs, series PDN, parallel PUN)

The NAND pull-down network is two n-channel devices in series (output goes low only when A and B are both high). The pull-up network is two p-channel devices in parallel (output goes high when either A or B is low). Effective overdrive: the series chain is limited by its weakest (smallest overdrive) device and is off if either device is off; the parallel pair conducts at its strongest (largest overdrive) device.

```js
function model(Va,Vb,VDD,Vt){
  Va=clamp(Va,0,VDD); Vb=clamp(Vb,0,VDD);
  var vonNa=Va-Vt, vonNb=Vb-Vt;            // n-channel overdrives (turn on with high input)
  var vonPa=(VDD-Va)-Vt, vonPb=(VDD-Vb)-Vt; // p-channel overdrives (turn on with low input)
  var vonN_eff=(vonNa>0 && vonNb>0)?Math.min(vonNa,vonNb):-1; // series: weakest limits, off if either off
  var vonP_eff=Math.max(vonPa,vonPb);                         // parallel: strongest conducts
  var lo=0,hi=VDD,Vout=VDD/2;
  for(var it=0;it<42;it++){var mid=(lo+hi)/2,In=imos(vonN_eff,mid),Ip=imos(vonP_eff,VDD-mid);if(In>Ip){hi=mid;}else{lo=mid;}Vout=mid;}
  var In=imos(vonN_eff,Vout),Ip=imos(vonP_eff,VDD-Vout),Ithru=(In+Ip)/2;
  var pdOn=(vonN_eff>0),puOn=(vonP_eff>0);
  var region=(pdOn&&puOn)?'switching':(puOn?'pull-up':(pdOn?'pull-down':'floating'));
  return {Va:Va,Vb:Vb,Vout:Vout,vonNa:vonNa,vonNb:vonNb,vonPa:vonPa,vonPb:vonPb,vonN_eff:vonN_eff,vonP_eff:vonP_eff,Ithru:Ithru,region:region,lA:(Va>VDD/2)?1:0,lB:(Vb>VDD/2)?1:0,lOut:(Vout>VDD/2)?1:0,VDD:VDD};
}
```

### 13.3 Controls and scope change

Add a second input slider (id `vinb`) next to `vin`; read both in `frame` and pass `model(Va,Vb,VDD,Vt)`. The transfer-curve scope sweeps one input while holding the other; hold B high and sweep A, so the curve collapses to the inverter shape (with B high the NAND is just NOT A). Label the scope X axis "V_A (B high)". Pack `lA, lB` into `s` for the truth-table highlight.

### 13.4 Tier changes (apply the section 8 patterns)

- symbol: NAND body (D-shape) with output bubble; route A (pin 1) and B (pin 2) to the two symbol inputs; 4-row truth table, highlight the row where `lA,lB` match; output is low only on the A=1,B=1 row.
- flow: pull-down is two valves in series in one drain pipe (the chamber empties only when both open); pull-up is two valves in parallel feeding the chamber (either fills it). A pilots one pull-down valve and one pull-up valve; B pilots the others. The supply, chamber, drain, and chamber-to-Y run are unchanged.
- valves: two NMOS pilot valves stacked in series between OUT and GND; two PMOS pilot valves in parallel between VCC and OUT. Drive each from its device overdrive.
- device: `mosfet` x4. PDN is two NMOS in a column (drain of the upper to source of the lower, source of the lower to GND, drain of the upper to OUT). PUN is two PMOS side by side, sources to VCC, drains joined to OUT. Gate of the A devices to the A bus, B devices to the B bus.
- silicon: on the right (substrate), two n-channel in series share a middle n+ diffusion (source, gate-A, shared, gate-B, drain pattern). On the left (n-well), two p-channel in parallel share source and drain rails. Group p-channel near VCC-left, n-channel near GND-right as before.

Everything else (helpers, frame, scope chrome, validation) is unchanged. Run all gates in section 10.

## 14. Appendix

### 14.1 Connection-point quick reference (inverter SOT-23-5)

```
VCC  pin 5  (280, 116)   top-left      supply runs end here
Y    pin 4  (500, 116)   top-right     output runs end here
NC   pin 1  (280, 456)   bottom-left   stub only
A    pin 2  (390, 456)   bottom-center input runs end here
GND  pin 3  (500, 456)   bottom-right  ground runs end here
```

### 14.2 Per-tier key constants (inverter, as built)

```
frame    PKX0=190 PKX1=590 PKY0=116 PKY1=456   (body 400 x 340, center x=390)
t1 sym   triangle bx=352 by 244..328 apex=452 my=286 bubble apex+11; truth table TX=40 TY=252
t2 flow  CX=400; supply 150..180; pull-up throat 226; chamber 262..316; pull-down throat 352; drain 394..424
t3 valv  T3PCX=414 walls 392/436; PT_Y=206 NT_Y=372 OUT 289; VCC res 150..176; GND res 400..426; gate cyl x=324; ovRange=2 maxLift=26
t4 dev   gx=378 termx=426; VCCy=178 OUTy=295 GNDy=410; boxes ~344..444
t5 sil   substrate 210..570 surface 306 bottom 440; n-well 206..392; PMOS left, NMOS right; Y bus y=252
scope    L=42 R=288 T=14 B=176; 80-sample sweep
```

### 14.3 Color usage map

```
HI    #5fd0ff  logic 1, supply, high voltage              wcol high end
LO    #566076  logic 0, ground, low voltage               wcol low end
ACCENT #ff5c8a input / pilot lines / gate buses / + charges
WATER2 #7fd0ff flow dots (hydraulic tiers)
ELEC  #5fd0ff  electron carriers (n-channel) / charge flow
HOLE  #ff7a59  hole carriers (p-channel)
BRONZE #d6a866 valve springs, saturated seats, "spring=V_t"
OK    #7ad6a0  on-state channel, healthy state labels
WARM  #ffe6c0  switching / shoot-through highlight
STEEL #9aa6bd  structure (package, pipes, plates, terminals)
OXIDE #caa46a  gate oxide
DIM/FAINT      secondary / tertiary labels
```

### 14.4 Datasheet checklist for a new part

Before writing any code, record from the part datasheet: exact part number and package variant, the package pin-function table (pin number to name), VCC operating range, the Boolean function, and the input thresholds. Do not proceed on a recalled pinout. Cite the datasheet revision in the footnote.

