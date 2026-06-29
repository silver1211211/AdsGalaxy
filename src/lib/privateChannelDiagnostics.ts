export type PrivateChannelDiagnostic = {
  token_received: boolean;
  token_valid: boolean;
  token_error_code: string;
  token_has_chat_id: boolean;
  digest_match: boolean;
  submit_channel_type: string;
  normalized_input_type: string;
  final_reject_reason: string;
};

export function logPrivateChannelDiagnostic(event: string, diagnostic: PrivateChannelDiagnostic) {
  if (process.env.NODE_ENV === "production") return;
  console.info("[private-channel-diagnostic]", { event, ...diagnostic });
}
