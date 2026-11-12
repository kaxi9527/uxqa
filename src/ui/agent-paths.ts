/** Project and preview-resource segments that must not be sent to the model. */
export const forbiddenAgentSegment = /^(?:\.git$|\.env(?:\.|$)|\.ssh$|\.gnupg$|\.aws$|\.kube$|\.npmrc$|\.netrc$|node_modules$|credentials?(?:\.|$)|secrets?(?:\.|$)|token\.json$|id_(?:rsa|ed25519)(?:\.|$)|package-lock\.json$|pnpm-lock\.yaml$|.*\.(?:lock|pem|key|p12|pfx)$)/i;
