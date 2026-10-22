import { SCIENCE_ICON } from './icon.js';

// Magpie owns writing and restoring this file; this module performs no I/O.
export const agent = {
  id: 'claude-science',
  name: 'Claude Science for Magpie',
  config: '~/.config/magpie/claude-science.json',
  format: 'json',
  model: 'model',
  dir: '/Applications/Claude Science.app',
  icon: SCIENCE_ICON,
  notice: '首次启用时尝试自动完成本机 Science 接入；打开 Claude Science 即可。若未就绪，查看 ~/.config/magpie/claude-science-runtime/autoinstall.log；需要 macOS 和 Node.js 22+。',
};

export function connect({ gateway, model }) {
  return {
    gateway: gateway.url,
    key: gateway.key,
    displayName: model.name || model.id,
  };
}
