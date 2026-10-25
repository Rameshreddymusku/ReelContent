import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall, useOnlineStatus } from './usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          if (isInstallable) {
            await install();
          } else {
            setShowGuide(true);
          }
        }}
        className="flex items-center gap-1.5 rounded-full bg-[#161513] px-3 py-1.5 text-[11px] font-mono font-medium text-[#F5F3EE] hover:bg-[#2B2925] transition-colors whitespace-nowrap shrink-0 min-h-[34px]"
        title="Install Studio 04 PWA"
      >
        <Download className="w-3.5 h-3.5 text-[#E04826]" />
        <span>{isIOS ? 'Install on iOS' : 'Install App'}</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-3xl bg-[#FAF8F5] border border-[#E5E0D5] p-6 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-[#E04826]" />
                <h3 className="text-base font-bold text-[#161513]">
                  Install Studio 04 App
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#6E6A63] hover:bg-[#EAE5DC]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#57534E] leading-relaxed mb-4">
              {isIOS
                ? '1. Tap the Share button in your Safari toolbar.\n2. Scroll down and select "Add to Home Screen" to launch Studio 04 in full-screen standalone mode.'
                : 'Open this app in a standalone tab or click the install icon in your browser address bar to add Studio 04 · Reel Shoots to your home screen for instant offline access.'}
            </p>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full h-11 rounded-2xl bg-[#161513] text-white text-xs font-mono font-semibold hover:bg-[#2B2925] transition-colors"
            >
              GOT IT
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full bg-[#161513] px-4 py-2 text-xs font-mono font-medium text-[#F5F3EE] shadow-lg">
      <span className="h-2 w-2 rounded-full bg-[#E04826]" />
      <span>Offline Mode — Cached schedule & tickets active</span>
    </div>
  );
};
