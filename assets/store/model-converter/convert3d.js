/* OBJ / STL parsing and writing. Meshes are { positions: Float32Array (x,y,z per vertex), triangles: Uint32Array }. */
window.Convert3D = (() => {
  function parseObj(text) {
    const verts = [];
    const tris = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('v ')) {
        const [, x, y, z] = line.split(/\s+/);
        verts.push(+x, +y, +z);
      } else if (line.startsWith('f ')) {
        const count = verts.length / 3;
        const idx = line.split(/\s+/).slice(1).map((tok) => {
          const n = parseInt(tok.split('/')[0], 10);
          return n < 0 ? count + n : n - 1;
        });
        for (let i = 1; i + 1 < idx.length; i++) tris.push(idx[0], idx[i], idx[i + 1]); // fan triangulation
      }
    }
    if (!tris.length) throw new Error('No faces found in this OBJ file');
    const max = verts.length / 3;
    if (tris.some((i) => i < 0 || i >= max || Number.isNaN(i))) throw new Error('OBJ refers to vertices that do not exist');
    return { positions: Float32Array.from(verts), triangles: Uint32Array.from(tris) };
  }

  function isBinaryStl(buf) {
    if (buf.byteLength < 84) return false;
    const n = new DataView(buf).getUint32(80, true);
    return 84 + n * 50 === buf.byteLength;
  }

  function parseStl(buf) {
    const positions = [];
    if (isBinaryStl(buf)) {
      const dv = new DataView(buf);
      const n = dv.getUint32(80, true);
      for (let t = 0; t < n; t++) {
        const off = 84 + t * 50 + 12;
        for (let k = 0; k < 9; k++) positions.push(dv.getFloat32(off + k * 4, true));
      }
    } else {
      const text = new TextDecoder().decode(buf);
      const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
      let m;
      while ((m = re.exec(text))) positions.push(+m[1], +m[2], +m[3]);
      if (!positions.length || positions.length % 9) throw new Error('Not a valid STL file');
    }
    // STL repeats shared vertices; merge identical ones.
    const map = new Map();
    const verts = [];
    const tris = new Uint32Array(positions.length / 3);
    for (let i = 0; i < positions.length; i += 3) {
      const key = positions[i] + ',' + positions[i + 1] + ',' + positions[i + 2];
      let idx = map.get(key);
      if (idx === undefined) { idx = verts.length / 3; map.set(key, idx); verts.push(positions[i], positions[i + 1], positions[i + 2]); }
      tris[i / 3] = idx;
    }
    return { positions: Float32Array.from(verts), triangles: tris };
  }

  function normal(p, a, b, c) {
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  }

  function writeStlBinary(mesh, name = 'model') {
    const n = mesh.triangles.length / 3;
    const buf = new ArrayBuffer(84 + n * 50);
    const dv = new DataView(buf);
    const header = new TextEncoder().encode(`WebDeck STL: ${name}`.slice(0, 79));
    new Uint8Array(buf, 0, 80).set(header);
    dv.setUint32(80, n, true);
    const p = mesh.positions, t = mesh.triangles;
    for (let i = 0; i < n; i++) {
      const off = 84 + i * 50;
      const [a, b, c] = [t[i * 3], t[i * 3 + 1], t[i * 3 + 2]];
      normal(p, a, b, c).forEach((v, k) => dv.setFloat32(off + k * 4, v, true));
      [a, b, c].forEach((vi, j) => { for (let k = 0; k < 3; k++) dv.setFloat32(off + 12 + j * 12 + k * 4, p[vi * 3 + k], true); });
    }
    return new Uint8Array(buf);
  }

  function writeStlAscii(mesh, name = 'model') {
    const p = mesh.positions, t = mesh.triangles, out = [`solid ${name}`];
    const f = (x) => x.toExponential(6);
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
      out.push(`  facet normal ${normal(p, a, b, c).map(f).join(' ')}`, '    outer loop');
      for (const v of [a, b, c]) out.push(`      vertex ${f(p[v * 3])} ${f(p[v * 3 + 1])} ${f(p[v * 3 + 2])}`);
      out.push('    endloop', '  endfacet');
    }
    out.push(`endsolid ${name}`);
    return out.join('\n') + '\n';
  }

  function writeObj(mesh, name = 'model') {
    const p = mesh.positions, t = mesh.triangles, out = [`# Converted by WebDeck`, `o ${name}`];
    for (let i = 0; i < p.length; i += 3) out.push(`v ${+p[i].toFixed(6)} ${+p[i + 1].toFixed(6)} ${+p[i + 2].toFixed(6)}`);
    for (let i = 0; i < t.length; i += 3) out.push(`f ${t[i] + 1} ${t[i + 1] + 1} ${t[i + 2] + 1}`);
    return out.join('\n') + '\n';
  }

  function stats(mesh) {
    const p = mesh.positions;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[i + k]); max[k] = Math.max(max[k], p[i + k]); }
    return { vertices: p.length / 3, triangles: mesh.triangles.length / 3, size: max.map((v, k) => v - min[k]) };
  }

  return { parseObj, parseStl, writeStlBinary, writeStlAscii, writeObj, stats, isBinaryStl };
})();
