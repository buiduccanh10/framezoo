const meta = useRuntimeConfig().public.meta;
export default defineEventHandler(event => {
  return {
    name: meta.name,
    description: meta.description,
    version: meta.version,
    hasCaptcha: meta.captcha === 'true',
    captchaClientKey: meta.captchaClientKey,
    hasTIDBSubmission:
      !!((useRuntimeConfig(event).tidbApiKey as string | undefined) || process.env.TIDB_API_KEY || '').trim(),
  };
});
