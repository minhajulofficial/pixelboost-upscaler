import { useState, useEffect } from 'react';
import { Sparkles, Mail, Globe, Github } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

type FooterLink = { label: string; url: string; enabled?: boolean; [key: string]: unknown };

export default function Footer() {
  const [footerLinks, setFooterLinks] = useState<{ platform: FooterLink[]; support: FooterLink[] }>({ platform: [], support: [] });
  const [footerText, setFooterText] = useState('Built by Minhajul Islam · Powered by CSV Tree');
  const [social, setSocial] = useState({ githubUrl: 'https://github.com/minhajulofficial/pixelboost-upscaler', githubEnabled: true, emailUrl: 'mailto:minhajulofficial.bd@gmail.com', emailEnabled: true, websiteUrl: 'https://csvtree.pro.bd', websiteEnabled: true });

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('site_config').select('value').eq('key', 'site_settings').maybeSingle();
        if (data?.value) {
          const s = data.value as Record<string, unknown>;
          if (Array.isArray(s.footerPlatformLinks)) setFooterLinks((prev) => ({ ...prev, platform: s.footerPlatformLinks as FooterLink[] }));
          if (Array.isArray(s.footerSupportLinks)) setFooterLinks((prev) => ({ ...prev, support: s.footerSupportLinks as FooterLink[] }));
          if (typeof s.footerText === 'string' && s.footerText.trim()) setFooterText(s.footerText);
          if (s.footerSocial && typeof s.footerSocial === 'object') {
            const fs = s.footerSocial as Record<string, unknown>;
            setSocial((prev) => ({
              githubUrl: typeof fs.githubUrl === 'string' ? fs.githubUrl : prev.githubUrl,
              githubEnabled: typeof fs.githubEnabled === 'boolean' ? fs.githubEnabled : prev.githubEnabled,
              emailUrl: typeof fs.emailUrl === 'string' ? fs.emailUrl : prev.emailUrl,
              emailEnabled: typeof fs.emailEnabled === 'boolean' ? fs.emailEnabled : prev.emailEnabled,
              websiteUrl: typeof fs.websiteUrl === 'string' ? fs.websiteUrl : prev.websiteUrl,
              websiteEnabled: typeof fs.websiteEnabled === 'boolean' ? fs.websiteEnabled : prev.websiteEnabled,
            }));
          }
        }
      } catch {}
    })();
  }, []);

  const defaultPlatform: FooterLink[] = [
    { label: 'Upscale', url: '/upscale' },
    { label: 'Dashboard', url: '/dashboard' },
    { label: 'Pricing', url: '/pricing' },
  ];
  const defaultSupport: FooterLink[] = [
    { label: 'Contact', url: 'mailto:minhajulofficial.bd@gmail.com' },
    { label: 'About', url: '/about' },
  ];

  const platformLinks = footerLinks.platform.length > 0 ? footerLinks.platform : defaultPlatform;
  const supportLinks = footerLinks.support.length > 0 ? footerLinks.support : defaultSupport;

  return (
    <footer className="mt-auto pt-12 pb-6 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-600">
                <Sparkles size={16} className="text-white" />
              </div>
              <span className="text-lg font-bold text-gray-900 dark:text-white">PixelBoost</span>
            </div>
            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              AI-powered image upscaler for microstock contributors. Server + on-device engines. No watermarks.
            </p>
            <div className="mt-3 flex gap-2">
              {social.githubEnabled && (
                <a href={social.githubUrl} target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-all">
                  <Github size={13} />
                </a>
              )}
              {social.emailEnabled && (
                <a href={social.emailUrl} className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-all">
                  <Mail size={13} />
                </a>
              )}
              {social.websiteEnabled && (
                <a href={social.websiteUrl} target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-all">
                  <Globe size={13} />
                </a>
              )}
            </div>
          </div>
          <div>
            <h4 className="text-[10px] font-bold text-gray-900 dark:text-white uppercase tracking-[0.2em] mb-3">Platform</h4>
            <ul className="space-y-2">
              {platformLinks.filter((l) => l.enabled !== false).map((link, i) => {
                const href = link.url || '#';
                return href.startsWith('/') ? (
                  <li key={i}><Link to={href} className="text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 transition-colors uppercase tracking-wider">{link.label}</Link></li>
                ) : (
                  <li key={i}><a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 transition-colors uppercase tracking-wider">{link.label}</a></li>
                );
              })}
            </ul>
          </div>
          <div>
            <h4 className="text-[10px] font-bold text-gray-900 dark:text-white uppercase tracking-[0.2em] mb-3">Support</h4>
            <ul className="space-y-2">
              {supportLinks.filter((l) => l.enabled !== false).map((link, i) => {
                const href = link.url || '#';
                return href.startsWith('/') ? (
                  <li key={i}><Link to={href} className="text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 transition-colors uppercase tracking-wider">{link.label}</Link></li>
                ) : (
                  <li key={i}><a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 transition-colors uppercase tracking-wider">{link.label}</a></li>
                );
              })}
            </ul>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 dark:border-gray-800 pt-4">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            {footerText}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-gray-500">v1.0 · Operational</p>
        </div>
      </div>
    </footer>
  );
}
