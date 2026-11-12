"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Loader2,
  Terminal,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LightVeilBackground } from "@/components/light-veil-background";

interface PasscodeGateProps {
  onUnlock: () => void;
}

export function PasscodeGate({ onUnlock }: PasscodeGateProps) {
  const [passcode, setPasscode] = useState("");
  const [showPasscode, setShowPasscode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const trimmed = passcode.trim();
    if (!trimmed) {
      setError("Please enter the workspace passcode.");
      inputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: trimmed }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Incorrect passcode. Please try again.");
        setLoading(false);
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }

      onUnlock();
    } catch {
      setError("Unable to verify passcode. Please check your connection.");
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-[#020307] text-zinc-100 px-4 py-12 overflow-hidden">
      <LightVeilBackground />

      <div className="relative z-10 w-full max-w-md space-y-6 animate-in fade-in-0 zoom-in-95 duration-300">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/35 bg-emerald-500/10 text-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.2)]">
            <Terminal className="h-5 w-5" />
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
              Smart Scraper
            </h1>
            <Badge
              variant="emerald"
              className="text-[10px] px-2 py-0 font-mono uppercase tracking-wider"
            >
              Protected
            </Badge>
          </div>
          <p className="text-xs text-zinc-400 max-w-xs">
            Enter your access passcode to unlock the recursive documentation
            crawler.
          </p>
        </div>

        {/* Passcode Card */}
        <Card className="border-white/10 bg-[#050811]/80 backdrop-blur-xl shadow-[0_24px_80px_-15px_rgba(0,0,0,0.85)]">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <Lock className="h-4 w-4 text-emerald-400" />
              <span>Workspace Access</span>
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400">
              Session remains unlocked for 7 days in this browser.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="workspace-passcode"
                  className="sr-only"
                >
                  Passcode
                </label>
                <div className="relative">
                  <Input
                    ref={inputRef}
                    id="workspace-passcode"
                    type={showPasscode ? "text" : "password"}
                    value={passcode}
                    onChange={(e) => {
                      setPasscode(e.target.value);
                      if (error) setError(null);
                    }}
                    disabled={loading}
                    placeholder="Enter passcode…"
                    autoComplete="current-password"
                    className="h-11 pr-10 font-mono text-sm bg-zinc-950/90 border-zinc-800 focus-visible:ring-emerald-500/60 focus-visible:border-emerald-500/60 placeholder:text-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasscode((prev) => !prev)}
                    aria-label={showPasscode ? "Hide passcode" : "Show passcode"}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showPasscode ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <Alert variant="destructive" className="py-2.5">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs font-mono">
                    {error}
                  </AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                variant="emerald"
                size="lg"
                disabled={loading}
                className="w-full h-11 font-semibold"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Verifying…</span>
                  </>
                ) : (
                  <>
                    <span>Unlock Workspace</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500/70" />
          <span>Verified server-side via HTTP-only session cookie</span>
        </div>
      </div>
    </div>
  );
}

