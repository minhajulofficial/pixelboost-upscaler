import { Sparkles, Mail, Globe, Github } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Footer() {
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
              <a href="https://github.com/minhajulofficial/pixelboost-upscaler" target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-all">
                <Github size={13} />
              </a>
              <a href="mailto:minhajulofficial.bd@gmail.com" className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-all">
                <Mail size={13} />
              </a>
              <a href="https://csvtree.pro.bd" target="_blank" rel="noopener noreferrer" className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-all">
                <Globe size={13} />
              </a>
            </div>
          </div>
          <div>
            <h4 className="text-[10px] font-bold text-gray-900 dark:text-white uppercase tracking-[0.2em] mb-3">Platform</h4>
            <ul className="space-y-2">
              <li><Link to="/upscale" className="text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 transition-colors uppercase tracking-wider">Upscale</Link></li>
              <li><Link to="/dashboard" className="text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 transition-colors uppercase tracking-wider">Dashboard</Link></li>
              <li><Link to="/pricing" className="text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 transition-colors uppercase tracking-wider">Pricing</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-[10px] font-bold text-gray-900 dark:text-white uppercase tracking-[0.2em] mb-3">Support</h4>
            <ul className="space-y-2">
              <li><a href="mailto:minhajulofficial.bd@gmail.com" className="text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 transition-colors uppercase tracking-wider">Contact</a></li>
              <li><Link to="/about" className="text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 transition-colors uppercase tracking-wider">About</Link></li>
            </ul>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 dark:border-gray-800 pt-4">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Built by <a href="https://github.com/minhajulofficial" target="_blank" rel="noopener noreferrer" className="font-semibold text-green-600 hover:text-green-500 dark:text-green-400 dark:hover:text-green-300">Minhajul Islam</a> · Powered by CSV Tree
          </p>
          <p className="text-[10px] uppercase tracking-wider text-gray-500">v1.0 · Operational</p>
        </div>
      </div>
    </footer>
  );
}
