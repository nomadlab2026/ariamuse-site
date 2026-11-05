/* ==========================================================================
   Aria Muse — minimal QR encoder (byte mode, versions 1-40, EC level M)
   Self-contained so the page never depends on a third-party QR service.
   Produces an SVG string via QRCode.toSvg(text, opts).
   ========================================================================== */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------ GF(256) */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d; // primitive polynomial
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /* ------------------------------------------------------ version tables */
  // EC level M: [ecCodewordsPerBlock, group1Blocks, group1DataCodewords,
  //              group2Blocks, group2DataCodewords] indexed by version-1.
  var EC_M = [
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37], [26, 4, 43, 1, 44], [30, 1, 50, 4, 51], [22, 6, 36, 2, 37],
    [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42], [28, 7, 45, 3, 46],
    [28, 10, 46, 1, 47], [26, 9, 43, 4, 44], [26, 3, 44, 11, 45], [26, 3, 41, 13, 42],
    [26, 17, 42, 0, 0], [28, 17, 46, 0, 0], [28, 4, 47, 14, 48], [28, 6, 45, 14, 46],
    [28, 8, 47, 13, 48], [28, 19, 46, 4, 47], [28, 22, 45, 3, 46], [28, 3, 45, 23, 46],
    [28, 21, 45, 7, 46], [28, 19, 47, 10, 48], [28, 2, 46, 29, 47], [28, 10, 46, 23, 47],
    [28, 14, 46, 21, 47], [28, 14, 46, 23, 47], [28, 12, 47, 26, 48], [28, 6, 47, 34, 48],
    [28, 29, 46, 14, 47], [28, 13, 46, 32, 47], [28, 40, 47, 7, 48], [28, 18, 47, 31, 48]
  ];

  // Total data codewords per version (level M), used for capacity checks.
  var DATA_M = [
    16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415,
    453, 507, 563, 627, 669, 714, 782, 860, 914, 1000, 1062, 1128, 1193,
    1267, 1373, 1455, 1541, 1631, 1725, 1812, 1914, 1992, 2102, 2216, 2334
  ];

  // Alignment pattern positions per version (index 0 = version 1).
  var ALIGN = [
    [], [6, 18], [6, 22], [6, 26], [6, 30],
    [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
    [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
    [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]
  ];

  function charCountBits(version) {
    // Byte mode: 8 bits for versions 1-9, 16 bits for 10-40.
    return version <= 9 ? 8 : 16;
  }

  function dataCapacityBytes(version) {
    var bits = DATA_M[version - 1] * 8;
    var cc = charCountBits(version);
    var modeBits = 4;
    return Math.floor((bits - modeBits - cc) / 8);
  }

  function pickVersion(byteLen) {
    for (var v = 1; v <= 40; v++) {
      if (dataCapacityBytes(v) >= byteLen) return v;
    }
    throw new Error("QR: data too long");
  }

  /* ------------------------------------------------------ bit buffer */
  function BitBuffer() {
    this.bytes = [];
    this.length = 0;
  }

  BitBuffer.prototype.put = function (value, bits) {
    for (var i = bits - 1; i >= 0; i--) {
      this.putBit(((value >>> i) & 1) === 1);
    }
  };

  BitBuffer.prototype.putBit = function (bit) {
    var idx = this.length >>> 3;
    if (this.bytes.length <= idx) this.bytes.push(0);
    if (bit) this.bytes[idx] |= 0x80 >>> (this.length & 7);
    this.length++;
  };

  /* ------------------------------------------------------ RS generator */
  function rsGenerator(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var res = new Array(data.length + ecLen).fill(0);
    for (var i = 0; i < data.length; i++) res[i] = data[i];

    for (var k = 0; k < data.length; k++) {
      var factor = res[k];
      if (factor === 0) continue;
      for (var j = 0; j < gen.length; j++) {
        res[k + j] ^= gfMul(gen[j], factor);
      }
    }
    return res.slice(data.length);
  }

  /* --------------------------------------------------------- encoding */
  function toUtf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function buildCodewords(bytes, version) {
    var spec = EC_M[version - 1];
    var totalData = DATA_M[version - 1];
    var buf = new BitBuffer();

    buf.put(4, 4);                       // byte mode
    buf.put(bytes.length, charCountBits(version));
    for (var i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);

    // Terminator (up to 4 zero bits)
    var capacity = totalData * 8;
    var term = Math.min(4, capacity - buf.length);
    buf.put(0, term);

    // Pad to byte boundary
    while (buf.length % 8 !== 0) buf.putBit(false);

    // Pad bytes
    var padBytes = [0xec, 0x11];
    var pi = 0;
    while (buf.length < capacity) {
      buf.put(padBytes[pi % 2], 8);
      pi++;
    }

    var data = buf.bytes.slice();

    /* ---- split into blocks ---- */
    var ecLen = spec[0];
    var g1Blocks = spec[1], g1Data = spec[2];
    var g2Blocks = spec[3], g2Data = spec[4];

    var blocks = [];
    var offset = 0;
    var i2;
    for (i2 = 0; i2 < g1Blocks; i2++) {
      blocks.push(data.slice(offset, offset + g1Data));
      offset += g1Data;
    }
    for (i2 = 0; i2 < g2Blocks; i2++) {
      blocks.push(data.slice(offset, offset + g2Data));
      offset += g2Data;
    }

    var ecBlocks = blocks.map(function (b) { return rsEncode(b, ecLen); });

    // Interleave data codewords
    var out = [];
    var maxData = Math.max(g1Data, g2Data);
    for (var col = 0; col < maxData; col++) {
      for (var b = 0; b < blocks.length; b++) {
        if (col < blocks[b].length) out.push(blocks[b][col]);
      }
    }
    // Interleave EC codewords
    for (var ec = 0; ec < ecLen; ec++) {
      for (var b2 = 0; b2 < ecBlocks.length; b2++) {
        out.push(ecBlocks[b2][ec]);
      }
    }
    return out;
  }

  /* ---------------------------------------------------- matrix drawing */
  function createMatrix(version) {
    var size = version * 4 + 17;
    var mod = [];
    for (var r = 0; r < size; r++) mod.push(new Array(size).fill(null));
    var reserved = [];
    for (var r2 = 0; r2 < size; r2++) reserved.push(new Array(size).fill(false));

    function setFn(r, c, v) {
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      mod[r][c] = v;
      reserved[r][c] = true;
    }

    // Finder patterns + separators
    function finder(r0, c0) {
      for (var dr = -1; dr <= 7; dr++) {
        for (var dc = -1; dc <= 7; dc++) {
          var r = r0 + dr, c = c0 + dc;
          if (r < 0 || c < 0 || r >= size || c >= size) continue;
          var inRing =
            (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
            (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6));
          var inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          setFn(r, c, (inRing || inCore) ? 1 : 0);
        }
      }
    }
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);

    // Alignment patterns.
    // NOTE: drawn before the timing patterns so that a centre sitting on
    // the timing row/column is still drawn (the timing pass then skips the
    // cells it already owns).
    var positions = ALIGN[version - 1];
    for (var a = 0; a < positions.length; a++) {
      for (var b = 0; b < positions.length; b++) {
        var ar = positions[a], ac = positions[b];
        // Skip positions already occupied by a finder pattern.
        if (reserved[ar][ac]) continue;
        for (var dr2 = -2; dr2 <= 2; dr2++) {
          for (var dc2 = -2; dc2 <= 2; dc2++) {
            var on = (dr2 === -2 || dr2 === 2 || dc2 === -2 || dc2 === 2 ||
                      (dr2 === 0 && dc2 === 0));
            setFn(ar + dr2, ac + dc2, on ? 1 : 0);
          }
        }
      }
    }

    // Timing patterns
    for (var i = 8; i < size - 8; i++) {
      var bit = i % 2 === 0 ? 1 : 0;
      if (!reserved[6][i]) setFn(6, i, bit);
      if (!reserved[i][6]) setFn(i, 6, bit);
    }

    // Reserve format info areas (exact coordinates used by placeFormat).
    for (var fi = 0; fi < 15; fi++) {
      if (fi < 6) setFn(fi, 8, 0);
      else if (fi < 8) setFn(fi + 1, 8, 0);
      else setFn(size - 15 + fi, 8, 0);
    }
    for (var fj = 0; fj < 15; fj++) {
      if (fj < 8) setFn(8, size - fj - 1, 0);
      else if (fj < 9) setFn(8, 15 - fj, 0);
      else setFn(8, 14 - fj, 0);
    }

    // Fixed dark module.
    setFn(size - 8, 8, 1);

    // Reserve version info areas (version >= 7)
    if (version >= 7) {
      for (var vr = 0; vr < 18; vr++) {
        var vrow = Math.floor(vr / 3);
        var vcol = vr % 3;
        setFn(size - 11 + vcol, vrow, 0);
        setFn(vrow, size - 11 + vcol, 0);
      }
    }

    return {
      size: size,
      mod: mod,
      reserved: reserved,
      setFn: setFn
    };
  }

  function placeData(m, codewords) {
    var size = m.size;
    var bitIndex = 0;
    var totalBits = codewords.length * 8;
    var dir = -1;
    var row = size - 1;

    for (var col = size - 1; col > 0; col -= 2) {
      // Skip the vertical timing column. Use a separate variable: the loop
      // counter itself must keep stepping by 2.
      var pair = (col <= 6) ? col - 1 : col;
      for (;;) {
        for (var c = 0; c < 2; c++) {
          var cc = pair - c;
          if (!m.reserved[row][cc]) {
            var bit = 0;
            if (bitIndex < totalBits) {
              bit = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
            }
            m.mod[row][cc] = bit;
            bitIndex++;
          }
        }
        row += dir;
        if (row < 0 || row >= size) {
          row -= dir;
          dir = -dir;
          break;
        }
      }
    }
  }

  /* --------------------------------------------------------- masking */
  function maskCondition(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function applyMask(m, mask) {
    for (var r = 0; r < m.size; r++) {
      for (var c = 0; c < m.size; c++) {
        if (!m.reserved[r][c] && maskCondition(mask, r, c)) {
          m.mod[r][c] ^= 1;
        }
      }
    }
  }

  /* --------------------------------------------------------- bch codes */
  // Degree of a polynomial over GF(2) — the index of its highest set bit.
  function degree(value) {
    var d = 0;
    while (value !== 0) {
      value >>>= 1;
      d++;
    }
    return d;
  }

  /**
   * BCH(15,5) format information.
   * data = (ecLevel << 3) | mask, then masked with 0x5412.
   */
  function formatBits(mask) {
    var data = (0 << 3) | mask;         // EC level M = 0
    var d = data << 10;
    var g = 0x537;
    while (degree(d) - degree(g) >= 0) {
      d ^= g << (degree(d) - degree(g));
    }
    return ((data << 10) | d) ^ 0x5412;
  }

  function placeFormat(m, mask, test) {
    var bits = formatBits(mask);
    var size = m.size;

    // In test mode every format module is light — this is the state the
    // mask penalty is measured against.
    var value = function (i) {
      return test ? 0 : (bits >>> i) & 1;
    };

    // Vertical copy — column 8.
    for (var i = 0; i < 15; i++) {
      var bit = value(i);
      if (i < 6) m.mod[i][8] = bit;
      else if (i < 8) m.mod[i + 1][8] = bit;
      else m.mod[size - 15 + i][8] = bit;
    }

    // Horizontal copy — row 8.
    for (var j = 0; j < 15; j++) {
      var bit2 = value(j);
      if (j < 8) m.mod[8][size - j - 1] = bit2;
      else if (j < 9) m.mod[8][15 - j] = bit2;
      else m.mod[8][14 - j] = bit2;
    }

    // Fixed dark module.
    m.mod[size - 8][8] = test ? 0 : 1;
  }

  /* Version info: BCH(18,6) */
  function versionBits(version) {
    var d = version << 12;
    var g = 0x1f25;
    while (degree(d) - degree(g) >= 0) {
      d ^= g << (degree(d) - degree(g));
    }
    return (version << 12) | d;
  }

  function placeVersion(m, version) {
    if (version < 7) return;
    var bits = versionBits(version);
    var size = m.size;
    for (var i = 0; i < 18; i++) {
      var bit = (bits >>> i) & 1;
      var row = Math.floor(i / 3);
      var col = i % 3;
      m.mod[size - 11 + col][row] = bit;
      m.mod[row][size - 11 + col] = bit;
    }
  }

  /* -------------------------------------------------------- penalty */
  /**
   * Mask penalty score, per ISO/IEC 18004. Higher = worse mask.
   * Implemented to match the reference implementation's semantics exactly
   * so the same mask is selected for the same input.
   */
  function penalty(m) {
    var size = m.size;
    var score = 0;

    // Rule 1 — runs of 5+ same-colour modules in a row/column.
    // Each run of length L >= 5 costs (L - 2).
    function runScore(line) {
      var s = 0;
      var run = 1;
      for (var i = 1; i < line.length; i++) {
        if (line[i] === line[i - 1]) {
          run++;
        } else {
          if (run >= 5) s += run - 2;
          run = 1;
        }
      }
      if (run >= 5) s += run - 2;
      return s;
    }

    for (var r = 0; r < size; r++) score += runScore(m.mod[r]);
    for (var c = 0; c < size; c++) {
      var col = [];
      for (var rr = 0; rr < size; rr++) col.push(m.mod[rr][c]);
      score += runScore(col);
    }

    // Rule 2 — 2x2 blocks of the same colour.
    for (var r2 = 0; r2 < size - 1; r2++) {
      for (var c2 = 0; c2 < size - 1; c2++) {
        var v = m.mod[r2][c2];
        if (v === m.mod[r2][c2 + 1] && v === m.mod[r2 + 1][c2] && v === m.mod[r2 + 1][c2 + 1]) {
          score += 3;
        }
      }
    }

    // Rule 3 — 1:1:3:1:1 ratio (dark:light:dark:light:dark) preceded or
    // followed by four light modules.
    function rule3(line, n) {
      var s = 0;
      for (var i = 0; i + 10 < n; i++) {
        var a = line[i], b = line[i + 1], d = line[i + 4], e = line[i + 5],
            f = line[i + 6], g = line[i + 9], h = line[i + 10];
        if (!b && d && !e && f && !g) {
          if ((a && line[i + 2] && line[i + 3] && !line[i + 7] && !line[i + 8] && !h) ||
              (!a && !line[i + 2] && !line[i + 3] && line[i + 7] && line[i + 8] && h)) {
            s += 40;
          }
        }
      }
      return s;
    }

    for (var r3 = 0; r3 < size; r3++) score += rule3(m.mod[r3], size);
    for (var c3 = 0; c3 < size; c3++) {
      var colLine = [];
      for (var r4 = 0; r4 < size; r4++) colLine.push(m.mod[r4][c3]);
      score += rule3(colLine, size);
    }

    // Rule 4 — deviation of the dark-module ratio from 50%.
    var dark = 0;
    for (var r5 = 0; r5 < size; r5++) {
      for (var c5 = 0; c5 < size; c5++) if (m.mod[r5][c5]) dark++;
    }
    var ratio = dark * 100 / (size * size);
    score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

    return score;
  }

  /* --------------------------------------------------------- public API */
  function encode(text, forcedMask) {
    var bytes = toUtf8Bytes(text);
    var version = pickVersion(bytes.length);
    var codewords = buildCodewords(bytes, version);

    if (typeof forcedMask === "number" && forcedMask >= 0 && forcedMask < 8) {
      var forced = createMatrix(version);
      placeData(forced, codewords);
      applyMask(forced, forcedMask);
      placeFormat(forced, forcedMask);
      placeVersion(forced, version);
      return forced;
    }

    // Mask selection: score each candidate with the format information left
    // blank (the "test" state used by the reference implementation), then
    // rebuild the winner with the real format bits.
    var bestMask = 0;
    var bestScore = 0;
    for (var mask = 0; mask < 8; mask++) {
      var probe = createMatrix(version);
      placeData(probe, codewords);
      applyMask(probe, mask);
      placeFormat(probe, mask, true); // test mode: format bits are all light
      placeVersion(probe, version);
      var p = penalty(probe);
      if (mask === 0 || bestScore > p) {
        bestScore = p;
        bestMask = mask;
      }
    }

    var result = createMatrix(version);
    placeData(result, codewords);
    applyMask(result, bestMask);
    placeFormat(result, bestMask);
    placeVersion(result, version);
    return result;
  }

  function toSvg(text, opts) {
    opts = opts || {};
    var margin = opts.margin === undefined ? 4 : opts.margin;
    var m = encode(text);
    var dim = m.size + margin * 2;

    var rects = [];
    for (var r = 0; r < m.size; r++) {
      for (var c = 0; c < m.size; c++) {
        if (m.mod[r][c]) {
          rects.push(
            "M" + (c + margin) + " " + (r + margin) + "h1v1h-1z"
          );
        }
      }
    }

    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + " " + dim + '" ' +
      'shape-rendering="crispEdges" width="' + dim * 8 + '" height="' + dim * 8 + '" role="img" aria-label="QR code">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="#ffffff"/>' +
      '<path d="' + rects.join("") + '" fill="#000000"/>' +
      "</svg>"
    );
  }

  global.QRCode = { encode: encode, toSvg: toSvg };
})(window);
