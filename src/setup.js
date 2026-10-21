import {parse,stringify} from 'smol-toml';
export const label='ai.magpie.claude-science';
export function checkOriginalConfig(text,originalDir){
  const c=parse(text||'');
  if(c.data_dir&&c.data_dir!==originalDir||c.data_dir_from||c.last_move_from)throw Error('Relocated Science installation: automatic setup refused');
  return c;
}
export function scienceConfig(text,{data,auth,port}){
  const c=parse(text||'');
  c.data_dir=data;c.port=port;c.default_model='claude-opus-5-5';c.disable_telemetry=true;
  c.paths={...c.paths,auth_dir:auth};
  return '# Managed by magpie-claude-science; uninstall restores the original file.\n'+stringify(c);
}
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function launchPlist({node,script,state,log}){
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${[node,script,state].map(x=>`<string>${xml(x)}</string>`).join('')}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string>
<key>ProcessType</key><string>Background</string>
</dict></plist>\n`;
}
