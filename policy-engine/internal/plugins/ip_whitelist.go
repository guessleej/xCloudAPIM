package plugins

import (
	"context"
	"net"
	"strings"

	"github.com/xcloudapim/policy-engine/internal/domain"
)

// IPWhitelistPlugin IP 白名單 / 黑名單
// config keys:
//   mode = "whitelist" | "blacklist"  (default: whitelist)
//   ips  = "1.2.3.4,10.0.0.0/8,192.168.1.0/24"
type IPWhitelistPlugin struct{}

func NewIPWhitelistPlugin() *IPWhitelistPlugin { return &IPWhitelistPlugin{} }

func (p *IPWhitelistPlugin) Type() domain.PolicyType { return domain.PolicyTypeIPWhitelist }

func (p *IPWhitelistPlugin) Validate(config map[string]string) []string {
	var errs []string
	if cfgGet(config, "ips") == "" {
		errs = append(errs, "ips is required")
		return errs
	}
	for _, ipOrCIDR := range parseCSV(cfgGet(config, "ips")) {
		ipOrCIDR = strings.TrimSpace(ipOrCIDR)
		if strings.Contains(ipOrCIDR, "/") {
			if _, _, err := net.ParseCIDR(ipOrCIDR); err != nil {
				errs = append(errs, "invalid CIDR: "+ipOrCIDR)
			}
		} else if net.ParseIP(ipOrCIDR) == nil {
			errs = append(errs, "invalid IP: "+ipOrCIDR)
		}
	}
	return errs
}

func (p *IPWhitelistPlugin) Execute(ctx context.Context, execCtx *domain.ExecContext, config map[string]string) error {
	mode   := cfgGetDefault(config, "mode", "whitelist")
	ipList := parseCSV(cfgGet(config, "ips"))

	// 優先取 X-Forwarded-For（反向代理後面的真實 IP）
	clientIP := execCtx.GetHeader("X-Forwarded-For")
	if clientIP == "" {
		clientIP = execCtx.GetHeader("X-Real-IP")
	}
	if clientIP == "" {
		clientIP = execCtx.RemoteIP
	}
	// X-Forwarded-For 可能是逗號清單，取第一個
	if idx := strings.Index(clientIP, ","); idx != -1 {
		clientIP = strings.TrimSpace(clientIP[:idx])
	}

	parsedIP := net.ParseIP(clientIP)
	if parsedIP == nil {
		execCtx.Abort(400, "invalid client IP address")
		return nil
	}

	matched := p.ipMatches(parsedIP, ipList)

	switch mode {
	case "whitelist":
		if !matched {
			execCtx.Abort(403, "access denied: IP not in whitelist")
		}
	case "blacklist":
		if matched {
			execCtx.Abort(403, "access denied: IP is blacklisted")
		}
	}

	return nil
}

func (p *IPWhitelistPlugin) ipMatches(ip net.IP, list []string) bool {
	for _, entry := range list {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if strings.Contains(entry, "/") {
			_, network, err := net.ParseCIDR(entry)
			if err == nil && network.Contains(ip) {
				return true
			}
		} else {
			if net.ParseIP(entry).Equal(ip) {
				return true
			}
		}
	}
	return false
}
