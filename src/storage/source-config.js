export function readSourceOptions(readFlag, args, defaults = {}) {
  return {
    platform: defaults.platform || 'facebook',
    sourceKey: readFlag(args, '--source-key', defaults.sourceKey || 'facebook-default'),
    sourceType: readFlag(args, '--source-type', defaults.sourceType || 'group'),
    displayName: readFlag(args, '--source-name', defaults.displayName || null),
    externalUrl: readFlag(args, '--source-url', defaults.externalUrl || null),
  };
}
