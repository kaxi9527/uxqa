export interface CliOptions {
  command: 'run' | 'components' | 'library' | 'component-plan' | 'component-sync';
  url?: string;
  config?: string;
  source?: string;
  out?: string;
  selector?: string;
  library?: string;
  definition?: string;
  plan?: string;
  headed: boolean;
  help: boolean;
  designTokens: boolean;
}

export function parseArgs(args: string[]): CliOptions {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') return { command: 'run', headed: false, help: true, designTokens:true };
  if (!['run','components','library','component-plan','component-sync'].includes(args[0])) throw new Error(`Unknown command: ${args[0]}`);
  const options: CliOptions = { command: args[0] as CliOptions['command'], headed: false, help: false, designTokens:true };
  const names = new Map<string, 'url'|'config'|'source'|'out'|'selector'|'library'|'definition'|'plan'>([
    ['--url','url'], ['--config','config'], ['--source','source'], ['--out','out'], ['--selector','selector'],
    ['--library','library'],['--definition','definition'],['--plan','plan'],
  ]);
  for (let index = 1; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help' || flag === '-h') { options.help = true; continue; }
    if (flag === '--headed') { options.headed = true; continue; }
    if (flag === '--no-design-tokens') { options.designTokens = false; continue; }
    const name = names.get(flag);
    if (!name) throw new Error(`Unknown flag: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (options[name]) throw new Error(`Repeated flag: ${flag}`);
    options[name] = value;
  }
  if (options.help) return options;
  if (options.command==='component-sync') {
    if (!options.plan || options.source || options.library || options.definition || options.url || options.config || options.selector || options.headed || !options.designTokens) throw new Error('component-sync requires --plan and optional --out only');
    return options;
  }
  if (options.plan) throw new Error('--plan requires component-sync');
  if (options.command==='library' || options.command==='component-plan') {
    if (!options.source) throw new Error('Library workflow requires --source');
    if (options.command==='component-plan' && !options.definition) throw new Error('component-plan requires --definition');
    if (options.command==='library' && options.definition) throw new Error('--definition requires component-plan');
    if (options.url || options.config || options.selector || options.headed || !options.designTokens) throw new Error('Library commands accept source/library/definition/out only');
    return options;
  }
  if (options.definition) throw new Error('--definition requires component-plan');
  if (options.library && (options.command!=='components' || !options.source)) throw new Error('--library requires a components --source audit or library workflow');
  if (options.command === 'run' && (options.source || options.selector || !options.designTokens)) throw new Error('--source, --selector and --no-design-tokens require components mode');
  if (!options.url && !options.config && !(options.command === 'components' && options.source)) {
    throw new Error('Provide --url, --config, or --source for a components audit');
  }
  return options;
}
