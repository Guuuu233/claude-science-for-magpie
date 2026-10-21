// Recognize only this published package/repository and explicitly owned local paths.
export function isSciencePlugin(spec, localSpecs=[]) {
  if(typeof spec!=='string'||!spec)return false;
  if(localSpecs.includes(spec))return true;
  if(/^magpie-claude-science(?:@[a-zA-Z0-9^~.*+_-][a-zA-Z0-9.^~*+_-]*)?$/.test(spec))return true;
  if(/^(?:github:)?(?:shiyang1026|Guuuu233)\/magpie-claude-science(?:#[^\s]+)?$/.test(spec))return true;
  try {
    const url=new URL(spec.replace(/^git\+/,''));
    return url.protocol==='https:'&&url.hostname==='github.com'&&!url.port&&!url.username&&!url.password&&!url.search&&/^\/(?:shiyang1026|Guuuu233)\/magpie-claude-science(?:\.git)?\/?$/.test(url.pathname);
  } catch {return false;}
}
export function enabledSciencePlugins(registry, localSpecs=[]) {
  return (registry?.plugins||[]).filter(entry=>!entry.off&&isSciencePlugin(entry.spec,localSpecs));
}
