// Minimal Cloudflare Worker for aggregated VLESS subscription and IP info
// 保留的功能: /gen 聚合订阅 + /ip /ipv4 /ipv6 IP查询

// 地区与提供商映射（用于命名）
const regionMapping = {
  US: ['🇺🇸 美国', 'US'], SG: ['🇸🇬 新加坡', 'SG'], JP: ['🇯🇵 日本', 'JP'], HK: ['🇭🇰 香港', 'HK'],
  KR: ['🇰🇷 韩国', 'KR'], DE: ['🇩🇪 德国', 'DE'], SE: ['🇸🇪 瑞典', 'SE'], NL: ['🇳🇱 荷兰', 'NL'],
  FI: ['🇫🇮 芬兰', 'FI'], GB: ['🇬🇧 英国', 'GB'], Oracle: ['甲骨文', 'Oracle'], DigitalOcean: ['数码海', 'DigitalOcean'],
  Vultr: ['Vultr', 'Vultr'], Multacom: ['Multacom', 'Multacom']
};

// 备用域名 (视为 443)
const backupIPs = [
  { domain: 'ProxyIP.US.CMLiussss.net', region: 'US', port: 443 },
  { domain: 'ProxyIP.SG.CMLiussss.net', region: 'SG', port: 443 },
  { domain: 'ProxyIP.JP.CMLiussss.net', region: 'JP', port: 443 },
  { domain: 'ProxyIP.HK.CMLiussss.net', region: 'HK', port: 443 },
  { domain: 'ProxyIP.KR.CMLiussss.net', region: 'KR', port: 443 },
  { domain: 'ProxyIP.DE.CMLiussss.net', region: 'DE', port: 443 },
  { domain: 'ProxyIP.SE.CMLiussss.net', region: 'SE', port: 443 },
  { domain: 'ProxyIP.NL.CMLiussss.net', region: 'NL', port: 443 },
  { domain: 'ProxyIP.FI.CMLiussss.net', region: 'FI', port: 443 },
  { domain: 'ProxyIP.GB.CMLiussss.net', region: 'GB', port: 443 },
  { domain: 'ProxyIP.Oracle.cmliussss.net', region: 'Oracle', port: 443 },
  { domain: 'ProxyIP.DigitalOcean.CMLiussss.net', region: 'DigitalOcean', port: 443 },
  { domain: 'ProxyIP.Vultr.CMLiussss.net', region: 'Vultr', port: 443 },
  { domain: 'ProxyIP.Multacom.CMLiussss.net', region: 'Multacom', port: 443 }
];

// 直连域名 -> 生成 80 / 443
const directDomains = ['yg1.ygkkk.dpdns.org','yg2.ygkkk.dpdns.org','yg3.ygkkk.dpdns.org','yg4.ygkkk.dpdns.org','yg5.ygkkk.dpdns.org','yg6.ygkkk.dpdns.org','yg7.ygkkk.dpdns.org','yg8.ygkkk.dpdns.org','yg9.ygkkk.dpdns.org','cloudflare.182682.xyz','speed.marisalnc.com','freeyx.cloudflare88.eu.org','bestcf.top','cdn.2020111.xyz','cfip.cfcdn.vip',
  'cf.0sm.com','cf.090227.xyz','cf.zhetengsha.eu.org','cloudflare.9jy.cc','cf.zerone-cdn.pp.ua','cfip.1323123.xyz',
  'cnamefuckxxs.yuchen.icu','cloudflare-ip.mofashi.ltd','115155.xyz','cname.xirancdn.us','f3058171cad.002404.xyz',
  '8.889288.xyz','cdn.tzpro.xyz','cf.877771.xyz','xn--b6gac.eu.org'
];

// 可配置的远程优选列表 (行格式: ip:port#name) 只取 80/443
function getPreferredUrl(env) {
  return env?.yxURL || 'https://raw.githubusercontent.com/qwer-search/bestip/refs/heads/main/kejilandbestip.txt';
}

// CORS 头
function cors(request) {
  const o = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400'
  };
}

// Base64 UTF-8 编解码，避免包含 Emoji/中文时报 btoa 错误
function base64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64DecodeUtf8(b64) {
  const binary = atob(b64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// 解析 VLESS 链接 (兼容 IPv6 / 无查询 / 保留原参数字符串)
function parseVless(link) {
  const raw = link.trim();
  const m = raw.match(/^vless:\/\/([^@]+)@(\[[^\]]+\]|[^:/?#]+):(\d+)(?:\?([^#]*))?(?:#(.*))?$/i);
  if (!m) throw new Error('无效的 VLESS 链接');
  const uuid = m[1];
  const host = m[2];
  const port = parseInt(m[3], 10);
  const paramStr = m[4] || '';
  const remarkRaw = m[5] || '';
  // 解析查询参数为对象（供可能的后续扩展，不修改，只保留）
  const paramsObj = {};
  if (paramStr) {
    paramStr.split('&').forEach(p => {
      const [k, v = ''] = p.split('=');
      if (k) paramsObj[decodeURIComponent(k)] = decodeURIComponent(v);
    });
  }
  return { uuid, host, port, params: paramStr, paramsObj, remark: remarkRaw };
}

// 解析 VMESS 链接 (vmess://Base64(JSON))
function parseVmess(link) {
  const raw = link.trim();
  if (!raw.toLowerCase().startsWith('vmess://')) throw new Error('无效的 VMESS 链接');
  const b64 = raw.slice(8).replace(/\s+/g, '');
  let jsonStr;
  try { jsonStr = base64DecodeUtf8(b64); } catch { throw new Error('VMESS Base64 解码失败'); }
  let obj;
  try { obj = JSON.parse(jsonStr); } catch { throw new Error('VMESS JSON 解析失败'); }
  obj.port = typeof obj.port === 'string' ? parseInt(obj.port, 10) : obj.port;
  if (!obj.id) throw new Error('VMESS 缺少 id');
  return obj; // 原样返回 JSON 对象
}

// 构造替换后的 VLESS 链接 (严格: 仅修改地址(add)与名称(ps)，其余参数与端口保持与 base 一致)
function buildVlessStrict(base, host, name) {
  const safe = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const qs = base.params ? `?${base.params}` : '';
  return `vless://${base.uuid}@${safe}:${base.port}${qs}#${encodeURIComponent(name)}`;
}

// 构造 VMESS 节点，仅修改 add 与 ps 其他字段原样保留
function buildVmessStrict(baseJson, host, name) {
  const node = { ...baseJson, add: host, ps: name };
  // 端口不变，保持与基准一致。仅修改主机与备注。
  return 'vmess://' + base64EncodeUtf8(JSON.stringify(node));
}

// 统一解析基准: 支持 vless / vmess
function parseUnified(raw) {
  const dec = decodeURIComponent(raw.trim());
  if (dec.startsWith('vless://')) return { type: 'vless', base: parseVless(dec) };
  if (dec.startsWith('vmess://')) return { type: 'vmess', base: parseVmess(dec) };
  throw new Error('不支持的协议，只支持 vless:// 或 vmess://');
}

// wetest 动态获取 (ipv4 + ipv6)
async function fetchWetest() {
  const urls = [
    'https://www.wetest.vip/page/cloudflare/address_v4.html',
    'https://www.wetest.vip/page/cloudflare/address_v6.html'
  ];
  const out = [];
  const rowRegex = /<tr[\s\S]*?<\/tr>/g;
  const cellRegex = /<td data-label="线路名称">(.+?)<\/td>[\s\S]*?<td data-label="优选地址">([\d.:a-fA-F]+)<\/td>/;
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      const html = await r.text();
      let m;
      while ((m = rowRegex.exec(html)) !== null) {
        const c = m[0].match(cellRegex);
        if (c) out.push({ isp: c[1].replace(/<.*?>/g, '').trim(), ip: c[2].trim() });
      }
    } catch {}
  }
  return out;
}

// 远程优选列表解析 (格式 ip:port#name)
async function fetchPreferred(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const text = await r.text();
    return text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
      const m = l.match(/^([^:]+):(\d+)#(.*)$/);
      if (!m) return null;
      return { ip: m[1], port: parseInt(m[2], 10), name: m[3].trim() || m[1] };
    }).filter(Boolean);
  } catch { return []; }
}

// 聚合所有来源 (只保留 80 / 443)
async function collectSources(env) {
  const list = [];
  // backupIPs 固定 443
  backupIPs.forEach(b => list.push({ host: b.domain, port: 443, region: b.region }));
  // directDomains -> 80 / 443
  directDomains.forEach(d => { list.push({ host: d, port: 80 }); list.push({ host: d, port: 443 }); });
  // wetest 动态 (两个端口)
  try {
    (await fetchWetest()).forEach(x => {
      list.push({ host: x.ip, port: 80, provider: x.isp });
      list.push({ host: x.ip, port: 443, provider: x.isp });
    });
  } catch {}
  // preferred 列表 (限定 80 / 443)
  try {
    (await fetchPreferred(getPreferredUrl(env))).forEach(x => {
      if (x.port === 80 || x.port === 443) list.push({ host: x.ip, port: x.port, provider: x.name });
    });
  } catch {}
  // 去重
  const seen = new Set();
  return list.filter(e => { const k = e.host + ':' + e.port; if (seen.has(k)) return false; seen.add(k); return true; });
}

// 从提供的名称中提取国家：若长度>5且含“-”，取“-”之前；否则未知（长度<=5保留原文）
function extractCountryFromProvider(provider) {
  if (!provider) return null;
  const txt = String(provider).trim();
  if (txt.length > 5) {
    const idx = txt.indexOf('-');
    if (idx !== -1) {
      const left = txt.slice(0, idx).trim();
      return left || '未知';
    }
    return '未知';
  }
  return txt; // 短名称直接使用，例如“韩国”“日本”等
}

// 构造展示名称：优先用已知地区映射，否则按规则从来源名提取国家
function displayName(entry) {
  const regionPart = entry.region && regionMapping[entry.region] ? regionMapping[entry.region][0] : '';
  if (regionPart) return regionPart;
  const fromProvider = extractCountryFromProvider(entry.provider);
  return fromProvider || '未知';
}

// 生成 Base64 聚合订阅
async function generateUnified(base80Raw, base443Raw, env) {
  const b80 = parseUnified(base80Raw);
  const b443 = parseUnified(base443Raw);
  if (b80.type !== b443.type) throw new Error('两个基准协议不一致');
  const port80 = b80.type === 'vless' ? b80.base.port : b80.base.port;
  const port443 = b443.type === 'vless' ? b443.base.port : b443.base.port;
  if (port80 !== 80) throw new Error('base80 端口必须为 80');
  if (port443 !== 443) throw new Error('base443 端口必须为 443');
  const sources = await collectSources(env);
  const lines = [];
  for (const s of sources) {
    const name = displayName(s);
    if (s.port === 80) {
      if (b80.type === 'vless') lines.push(buildVlessStrict(b80.base, s.host, name));
      else lines.push(buildVmessStrict(b80.base, s.host, name));
    } else if (s.port === 443) {
      if (b443.type === 'vless') lines.push(buildVlessStrict(b443.base, s.host, name));
      else lines.push(buildVmessStrict(b443.base, s.host, name));
    }
  }
  if (!lines.length) throw new Error('无可用节点');
  return base64EncodeUtf8(lines.join('\n'));
}

// IP 信息
function getIpInfo(request) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  return { ip, version: ip.includes(':') ? 'ipv6' : (ip ? 'ipv4' : 'unknown') };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(request) });

    // 聚合订阅
    if (url.pathname === '/gen' && request.method === 'GET') {
      const base80 = url.searchParams.get('base80');
      const base443 = url.searchParams.get('base443');
      if (!base80 || !base443) {
        return new Response(JSON.stringify({ error: '缺少 base80 或 base443 参数' }), { status: 400, headers: { 'Content-Type': 'application/json', ...cors(request) } });
      }
      try {
        const data = await generateUnified(base80, base443, env);
        return new Response(data, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...cors(request) } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors(request) } });
      }
    }

    // IP 路由
    if (['/ip','/ipv4','/ipv6'].includes(url.pathname) && request.method === 'GET') {
      const info = getIpInfo(request);
      const wantsText = url.searchParams.has('text') || (url.searchParams.get('format') || '').toLowerCase() === 'txt';
      if (url.pathname === '/ipv4' && info.version !== 'ipv4') return new Response(JSON.stringify({ error: 'not ipv4', ip: info.ip, version: info.version }), { status: 409, headers: { 'Content-Type': 'application/json', ...cors(request) } });
      if (url.pathname === '/ipv6' && info.version !== 'ipv6') return new Response(JSON.stringify({ error: 'not ipv6', ip: info.ip, version: info.version }), { status: 409, headers: { 'Content-Type': 'application/json', ...cors(request) } });
      if (wantsText || url.pathname === '/ipv4' || url.pathname === '/ipv6') return new Response(info.ip, { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors(request) } });
      return new Response(JSON.stringify(info), { headers: { 'Content-Type': 'application/json', ...cors(request) } });
    }

    // 简单首页提示
    if (url.pathname === '/' && request.method === 'GET') {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Worker</title><style>body{font-family:monospace;background:#111;color:#0f0;padding:2rem}a,code{color:#6f6}</style></head><body><h1>Minimal Worker</h1><p>聚合订阅: <code>/gen?base80=&lt;vless/vmess 80&gt;&amp;base443=&lt;vless/vmess 443&gt;</code></p><p><a href="/gen-ui">打开可视化生成页 /gen-ui</a></p><p>IP: <code>/ip</code> / <code>/ipv4</code> / <code>/ipv6</code></p></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors(request) } });
    }

    // 可视化表单页：填写 base80 与 base443
    if (url.pathname === '/gen-ui' && request.method === 'GET') {
      const page = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>订阅生成器</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0b1020;color:#e6f2ff;margin:0}
.wrap{max-width:900px;margin:0 auto;padding:24px}
textarea{width:100%;min-height:100px;background:#0e152b;color:#d3ecff;border:1px solid #294a6b;border-radius:8px;padding:10px;box-sizing:border-box}
button{background:#2563eb;color:#fff;border:none;padding:10px 16px;border-radius:8px;cursor:pointer}
button:disabled{opacity:.6;cursor:not-allowed}
.row{margin:12px 0}
.hint{color:#8fb8ff;font-size:12px}
.result{min-height:160px}
input[type=text]{width:100%;background:#0e152b;color:#d3ecff;border:1px solid #294a6b;border-radius:8px;padding:10px;box-sizing:border-box}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
a{color:#8fb8ff}
</style></head>
<body><div class="wrap">
  <h2>聚合订阅生成器</h2>
  <div class="row"><label>80 基准（vless:// 或 vmess://）</label>
    <textarea id="b80" placeholder="粘贴 80 端口的基准链接"></textarea>
  </div>
  <div class="row"><label>443 基准（vless:// 或 vmess://）</label>
    <textarea id="b443" placeholder="粘贴 443 端口的基准链接"></textarea>
  </div>
  <div class="grid">
    <button id="gen">生成订阅</button>
    <button id="copy" disabled>复制订阅</button>
  </div>
  <div class="row"><label>订阅内容（Base64）：</label>
    <textarea id="out" class="result" readonly></textarea>
  </div>
  <div class="row hint">
    也可直接访问: <code>/gen?base80=...&amp;base443=...</code>（参数需 URL 编码）
  </div>
  <div class="row"><label>订阅链接：</label>
    <input id="suburl" type="text" readonly/>
  </div>
  <p><a href="/">返回主页</a></p>
</div>
<script>
const $ = (id)=>document.getElementById(id);
$('gen').onclick = async () => {
  const b80 = $('b80').value.trim();
  const b443 = $('b443').value.trim();
  if(!b80||!b443){ alert('请填写两个基准链接'); return; }
  const url = '/gen?base80=' + encodeURIComponent(b80) + '&base443=' + encodeURIComponent(b443);
  $('suburl').value = location.origin + url;
  $('out').value = '生成中...';
  $('copy').disabled = true;
  try {
    const res = await fetch(url);
    const txt = await res.text();
    if(!res.ok){
      $('out').value = txt;
      return;
    }
    $('out').value = txt;
    $('copy').disabled = false;
  } catch (e) {
    $('out').value = '请求失败: ' + (e?.message||e);
  }
};
$('copy').onclick = async ()=>{
  try { await navigator.clipboard.writeText($('out').value); $('copy').innerText='已复制'; setTimeout(()=>$('copy').innerText='复制订阅',1200); } catch{}
};
</script>
</body></html>`;
      return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors(request) } });
    }

        return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors(request) } });
    }
};
