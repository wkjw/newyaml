## 新增聚合订阅 /gen-ui    /gen

来源包括：
- 内置 `backupIPs` (443)
- `directDomains` (生成 80 与 443)
- 动态优选 wetest IPv4 / IPv6 (生成 80 与 443)
- `preferredIPsURL` 抓取的新 IP 列表 (仅保留端口为 80/443)

调用方式：
```
https://<域名>/gen?base80=<URLENCODE(vless80)>\&base443=<URLENCODE(vless443)>
```

返回值：Base64（每行一个 vless 节点）。

示例（PowerShell）：
```powershell
$b80 = 'vless://UUID@origin.example.com:80?encryption=none&type=ws&security=none&host=origin.example.com&path=%2F#BASE80'
$b443 = 'vless://UUID@origin.example.com:443?encryption=none&type=ws&security=tls&host=origin.example.com&path=%2F#BASE443'
$url = 'https://<你的域名>/gen?base80=' + [System.Uri]::EscapeDataString($b80) + '&base443=' + [System.Uri]::EscapeDataString($b443)
curl -s $url
```

