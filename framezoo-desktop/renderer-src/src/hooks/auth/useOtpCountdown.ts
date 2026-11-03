import { useEffect, useState } from "react";

export function useOtpCountdown(
  initialExpiresIn: number,
  initialResendAfter = 0,
) {
  const [expiresIn, setExpiresIn] = useState(initialExpiresIn);
  const [resendAfter, setResendAfter] = useState(initialResendAfter);

  useEffect(() => {
    setExpiresIn(initialExpiresIn);
    setResendAfter(initialResendAfter);
  }, [initialExpiresIn, initialResendAfter]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setExpiresIn((current) => Math.max(0, current - 1));
      setResendAfter((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const reset = (nextExpiresIn: number, nextResendAfter = 60) => {
    setExpiresIn(nextExpiresIn);
    setResendAfter(nextResendAfter > 0 ? nextResendAfter : 60);
  };

  const formattedTime = `${Math.floor(expiresIn / 60)}:${String(
    expiresIn % 60,
  ).padStart(2, "0")}`;

  return {
    expiresIn,
    resendAfter,
    isExpired: expiresIn <= 0,
    canResend: resendAfter <= 0,
    formattedTime,
    reset,
  };
}
