// Внешние ссылки приложения. Окно может попросить открыть только то, что
// объявлено здесь, — произвольный адрес из рендерера в shell.openExternal не уходит.

/**
 * Страница с реквизитами для поддержки проекта (SUPPORT.md в репозитории).
 * Пустая строка — кнопка «Поддержать» в интерфейсе не показывается.
 */
export const SUPPORT_URL = 'https://github.com/Andreynebolee/CSFloatDealAlerts/blob/main/SUPPORT.md';

export function isSafeHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
