import { Sparkles, Mail, Globe, Github } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-gray-800 bg-gray-950 px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-purple-600">
                <Sparkles size={14} className="text-white" />
              </div>
              <span className="font-bold text-white">PixelBoost</span>
            </div>
            <p className="text-xs leading-relaxed text-gray-400">
              AI-powered image upscaler for microstock contributors. Server + on-device engines. No watermarks.
            </p>
            <div className="mt-3 flex gap-2">
              <a href="https://github.com/minhajulofficial/pixelboost-upscaler" target="_blank" rel="noopener noreferrer" className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white">
                <Github size={13} />
              </a>
              <a href="mailto:minhajulofficial.bd@gmail.com" className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white">
                <Mail size={13} />
              </a>
              <a href="https://csvtree.pro.bd" target="_blank" rel="noopener noreferrer" className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white">
                <Globe size={13} />
              </a>
            </div>
          </div>
          <div>
            <h4 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white">Platform</h4>
            <ul className="space-y-2 text-xs">
              <li><Link to="/upscale" className="text-gray-400 hover:text-white">Upscale</Link></li>
              <li><Link to="/dashboard" className="text-gray-400 hover:text-white">Dashboard</Link></li>
              <li><Link to="/pricing" className="text-gray-400 hover:text-white">Pricing</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white">Support</h4>
            <ul className="space-y-2 text-xs">
              <li><a href="mailto:minhajulofficial.bd@gmail.com" className="text-gray-400 hover:text-white">Contact</a></li>
              <li><span className="text-gray-500">© {new Date().getFullYear()} PixelBoost</span></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-gray-800 pt-4">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            Built by <a href="https://github.com/minhajulofficial" target="_blank" rel="noopener noreferrer" className="font-semibold text-purple-400 hover:text-purple-300">Minhajul Islam</a> · Inspired by CSV Tree
          </p>
          <p className="text-[10px] uppercase tracking-wider text-gray-500">v1.0 · Operational</p>
        </div>
      </div>
    </footer>
  );
}
