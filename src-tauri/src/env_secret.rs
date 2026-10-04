//! Environment variables a secret reference may read. Std only, so it can be
//! tested without a Tauri build. The policy matches the Node server's
//! `/api/env-secret` route: only `RISU_*_KEY` / `RISU_*_TOKEN` names and names the
//! operator lists in `RISU_ALLOWED_ENV` are readable.

use std::ffi::OsString;

/// Comma-separated exact names the operator allows beyond the `RISU_*_KEY|TOKEN` pattern.
pub const ALLOWED_ENV: &str = "RISU_ALLOWED_ENV";

/// The only error the caller ever sees, so a name that is not allowed and one that
/// is not set cannot be told apart.
const UNAVAILABLE: &str = "unavailable";

fn has_env_syntax(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_uppercase() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

fn is_risu_key_name(name: &str) -> bool {
    let Some(middle) = name.strip_prefix("RISU_") else {
        return false;
    };
    // `^RISU_[A-Z0-9_]*_(KEY|TOKEN)$`: the suffix keeps its own leading underscore.
    let stem = if let Some(stem) = middle.strip_suffix("_KEY") {
        stem
    } else if let Some(stem) = middle.strip_suffix("_TOKEN") {
        stem
    } else {
        return false;
    };
    stem.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

pub fn is_resolvable_env_name(name: &str, lookup: impl Fn(&str) -> Option<OsString>) -> bool {
    if !has_env_syntax(name) {
        return false;
    }
    if is_risu_key_name(name) {
        return true;
    }
    lookup(ALLOWED_ENV)
        .and_then(|list| list.into_string().ok())
        .is_some_and(|list| list.split(',').map(str::trim).any(|entry| !entry.is_empty() && entry == name))
}

/// The trimmed value of an allowed variable. Not allowed, not set, not UTF-8,
/// empty and multi-line values all fail with the same error, and the value is
/// never included in any error.
pub fn resolve_env_secret(
    name: &str,
    lookup: impl Fn(&str) -> Option<OsString>,
) -> Result<String, String> {
    if !is_resolvable_env_name(name, &lookup) {
        return Err(UNAVAILABLE.to_string());
    }
    let value = lookup(name)
        .and_then(|raw| raw.into_string().ok())
        .map(|raw| raw.trim().to_string())
        .unwrap_or_default();
    if value.is_empty() || value.contains('\r') || value.contains('\n') {
        return Err(UNAVAILABLE.to_string());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |name| map.get(name).map(OsString::from)
    }

    #[test]
    fn risu_key_and_token_names_resolve() {
        let lookup = env(&[("RISU_OPENAI_KEY", "sk-1"), ("RISU_X_TOKEN", "t")]);
        assert_eq!(resolve_env_secret("RISU_OPENAI_KEY", &lookup), Ok("sk-1".into()));
        assert_eq!(resolve_env_secret("RISU_X_TOKEN", &lookup), Ok("t".into()));
    }

    #[test]
    fn risu_pattern_requires_a_suffix_and_the_prefix() {
        let lookup = env(&[
            ("RISU_KEY", "v"),
            ("RISU_OPENAI", "v"),
            ("MYRISU_A_KEY", "v"),
            ("RISU__KEY", "v"),
        ]);
        assert!(!is_resolvable_env_name("RISU_KEY", &lookup));
        assert!(!is_resolvable_env_name("RISU_OPENAI", &lookup));
        assert!(!is_resolvable_env_name("MYRISU_A_KEY", &lookup));
        assert!(is_resolvable_env_name("RISU__KEY", &lookup));
    }

    #[test]
    fn allow_listed_exact_name_resolves_with_whitespace_in_the_list() {
        let lookup = env(&[
            (ALLOWED_ENV, " FOO_API , ,BAR_API"),
            ("FOO_API", "a"),
            ("BAR_API", "b"),
            ("BAZ_API", "c"),
        ]);
        assert_eq!(resolve_env_secret("FOO_API", &lookup), Ok("a".into()));
        assert_eq!(resolve_env_secret("BAR_API", &lookup), Ok("b".into()));
        assert!(resolve_env_secret("BAZ_API", &lookup).is_err());
        assert!(resolve_env_secret("FOO", &lookup).is_err());
    }

    #[test]
    fn disallowed_names_are_rejected() {
        let lookup = env(&[("PATH", "/bin"), ("AWS_SECRET_ACCESS_KEY", "s")]);
        assert!(resolve_env_secret("PATH", &lookup).is_err());
        assert!(resolve_env_secret("AWS_SECRET_ACCESS_KEY", &lookup).is_err());
    }

    #[test]
    fn bad_syntax_is_rejected_even_when_listed() {
        let lookup = env(&[
            (ALLOWED_ENV, "risu_a_key,RISU-A-KEY,,1ABC"),
            ("risu_a_key", "v"),
            ("RISU-A-KEY", "v"),
            ("1ABC", "v"),
        ]);
        assert!(resolve_env_secret("risu_a_key", &lookup).is_err());
        assert!(resolve_env_secret("RISU-A-KEY", &lookup).is_err());
        assert!(resolve_env_secret("1ABC", &lookup).is_err());
        assert!(resolve_env_secret("", &lookup).is_err());
    }

    #[test]
    fn unset_and_not_allowed_answer_identically() {
        let lookup = env(&[("PATH", "/bin")]);
        assert_eq!(
            resolve_env_secret("RISU_MISSING_KEY", &lookup),
            resolve_env_secret("PATH", &lookup)
        );
    }

    #[test]
    fn empty_and_blank_values_are_unavailable() {
        let lookup = env(&[("RISU_A_KEY", ""), ("RISU_B_KEY", "  \t ")]);
        assert!(resolve_env_secret("RISU_A_KEY", &lookup).is_err());
        assert!(resolve_env_secret("RISU_B_KEY", &lookup).is_err());
    }

    #[test]
    fn multi_line_values_are_unavailable() {
        let lookup = env(&[("RISU_A_KEY", "a\r\nb"), ("RISU_B_KEY", "a\nb")]);
        assert!(resolve_env_secret("RISU_A_KEY", &lookup).is_err());
        assert!(resolve_env_secret("RISU_B_KEY", &lookup).is_err());
    }

    #[test]
    fn surrounding_whitespace_and_a_trailing_newline_are_trimmed() {
        let lookup = env(&[("RISU_A_KEY", "  sk-1 \r\n")]);
        assert_eq!(resolve_env_secret("RISU_A_KEY", &lookup), Ok("sk-1".into()));
    }
}
