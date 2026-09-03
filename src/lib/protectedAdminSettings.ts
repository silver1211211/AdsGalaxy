export const PROTECTED_MINIAPP_DYNAMIC_CPM_SETTING_PREFIX = "miniapp_publisher_cpm_v2_";
export const ADMIN_EDITABLE_MINIAPP_DYNAMIC_CPM_KEYS = new Set([
  "miniapp_publisher_cpm_v2_max_share",
  "miniapp_publisher_cpm_v2_reserve_share",
]);

export function isMiniAppDynamicCpmSettingKey(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .startsWith(PROTECTED_MINIAPP_DYNAMIC_CPM_SETTING_PREFIX);
}

export function isProtectedAdminSettingKey(value: unknown) {
  const key = String(value || "").trim().toLowerCase();
  return isMiniAppDynamicCpmSettingKey(key) && !ADMIN_EDITABLE_MINIAPP_DYNAMIC_CPM_KEYS.has(key);
}

export function protectedAdminSettingKeys(values: unknown[]) {
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => isProtectedAdminSettingKey(value));
}
