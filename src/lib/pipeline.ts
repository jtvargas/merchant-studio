// Descriptor cleaning + matching engine — TypeScript port of the Python
// validator that scored 100% on the pack's labeled test set.
//
// Matching order (documented in the pack README):
//   1. processor-prefix strip -> match the REMAINDER (merchant, then rules)
//   2. raw-normalized text  (lowercase, unaccented, apostrophes->spaces)
//   3. regex/phrase-cleaned text ("light")
//   4. fully cleaned text with removeWordsExact removed ("full")
//   5. category rules by descending priority

import type { Merchant, MerchantsDoc, NoiseDoc, Rule, RulesDoc } from './schema';
import { unaccent } from './schema';

export interface MatchResult {
  merchant: Merchant | null;
  matchedAlias: string | null;
  method: string | null; // "exact:raw" | "contains:light" | ...
  rule: Rule | null;
  category: string | null;
  merchantId: string | null;
  displayName: string | null;
  confidence: number | null;
  tags: string[];
  stages: { rawnorm: string; light: string; full: string; prefixRemainder: string | null };
  negativeSkips: { merchantId: string; alias: string; negative: string }[];
}

interface CompiledRule {
  rule: Rule;
  cany: string[];
  call: string[];
  cnot: string[];
  rxs: RegExp[];
}

export class Pipeline {
  private patterns: { rx: RegExp; rep: string }[] = [];
  private removePhrases: string[] = [];
  private removeWords: Set<string>;
  private preserve: Set<string>;
  private exact = new Map<string, Merchant>();
  private contains: { alias: string; m: Merchant }[] = [];
  private prefixRe: RegExp | null = null;
  private rules: CompiledRule[] = [];
  private tagRules: CompiledRule[] = [];

  constructor(merchantsDoc: MerchantsDoc, rulesDoc: RulesDoc, noise: NoiseDoc) {
    for (const p of noise.regexPatterns) {
      try {
        this.patterns.push({ rx: new RegExp(p.pattern, 'gi'), rep: p.replacement });
      } catch {
        /* unsupported pattern — skip, validation page reports it */
      }
    }
    this.removePhrases = [...noise.removePhrases].sort((a, b) => b.length - a.length);
    this.preserve = new Set(noise.preserveTerms);
    this.removeWords = new Set(noise.removeWordsExact.filter((w) => !this.preserve.has(w)));

    for (const m of merchantsDoc.merchants) {
      for (const a of m.aliases) {
        if (!this.exact.has(a)) this.exact.set(a, m);
        if (a.length >= 3) this.contains.push({ alias: a, m });
      }
    }
    this.contains.sort((a, b) => b.alias.length - a.alias.length);

    const alts = noise.processorTokens.map((tok) =>
      tok.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '\\s*\\*').replace(/\s+/g, '\\s*'),
    );
    if (alts.length) this.prefixRe = new RegExp('^\\s*(?:' + alts.join('|') + ')\\s*', 'i');

    const sorted = [...rulesDoc.rules].sort((a, b) => b.priority - a.priority);
    for (const rule of sorted) {
      const c: CompiledRule = {
        rule,
        cany: (rule.match.containsAny ?? []).map((s) => unaccent(s).toLowerCase()),
        call: (rule.match.containsAll ?? []).map((s) => unaccent(s).toLowerCase()),
        cnot: (rule.match.notContainsAny ?? []).map((s) => unaccent(s).toLowerCase()),
        rxs: (rule.match.regexAny ?? []).flatMap((s) => {
          try { return [new RegExp(s, 'i')]; } catch { return []; }
        }),
      };
      if (rule.result.category) this.rules.push(c);
      else this.tagRules.push(c);
    }
  }

  rawNormalize(raw: string): string {
    return unaccent(raw).toLowerCase().replace(/['’]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  cleanLight(raw: string): string {
    let s = unaccent(raw).toLowerCase();
    for (const { rx, rep } of this.patterns) s = s.replace(rx, rep);
    for (const ph of this.removePhrases) s = s.split(ph).join(' ');
    return s.replace(/\s+/g, ' ').trim();
  }

  cleanFull(light: string): string {
    const toks = light.match(/[a-z0-9&+.'/*#-]+/g) ?? [];
    return toks.filter((t) => !this.removeWords.has(t) || this.preserve.has(t)).join(' ');
  }

  private matchMerchant(
    text: string,
    stage: string,
    skips: MatchResult['negativeSkips'],
  ): { m: Merchant; alias: string; method: string } | null {
    const ex = this.exact.get(text);
    if (ex) return { m: ex, alias: text, method: `exact:${stage}` };
    for (const { alias, m } of this.contains) {
      if (text.includes(alias)) {
        const neg = (m.negativeAliases ?? []).find((n) => text.includes(n));
        if (neg) {
          skips.push({ merchantId: m.id, alias, negative: neg });
          continue;
        }
        return { m, alias, method: `contains:${stage}` };
      }
    }
    return null;
  }

  private matchRule(text: string, compiled: CompiledRule[]): Rule | null {
    for (const c of compiled) {
      if (c.cnot.length && c.cnot.some((s) => text.includes(s))) continue;
      let hit = (c.cany.length > 0 && c.cany.some((s) => text.includes(s))) ||
        c.rxs.some((rx) => rx.test(text));
      if (c.call.length) hit = hit && c.call.every((s) => text.includes(s));
      if (hit) return c.rule;
    }
    return null;
  }

  private stripPrefix(text: string): string | null {
    if (!this.prefixRe) return null;
    const m = this.prefixRe.exec(text);
    if (m && m[0].length < text.length && m[0].length > 0) return text.slice(m[0].length).trim();
    return null;
  }

  match(raw: string): MatchResult {
    const rawnorm = this.rawNormalize(raw);
    const light = this.cleanLight(raw);
    const full = this.cleanFull(light);
    const skips: MatchResult['negativeSkips'] = [];
    const remainder = this.stripPrefix(light) ?? this.stripPrefix(rawnorm);

    const tags: string[] = [];
    for (const c of this.tagRules) {
      if (this.matchRule(light, [c]) || this.matchRule(rawnorm, [c])) {
        tags.push(...(c.rule.result.tags ?? []));
      }
    }

    let hit: { m: Merchant; alias: string; method: string } | null = null;
    let rule: Rule | null = null;

    if (remainder) {
      hit = this.matchMerchant(remainder, 'remainder', skips);
      if (!hit) rule = this.matchRule(remainder, this.rules);
    }
    if (!hit && !rule) {
      for (const [text, stage] of [[rawnorm, 'raw'], [light, 'light'], [full, 'full']] as const) {
        hit = this.matchMerchant(text, stage, skips);
        if (hit) break;
      }
    }
    if (!hit && !rule) rule = this.matchRule(light, this.rules) ?? this.matchRule(full, this.rules);

    return {
      merchant: hit?.m ?? null,
      matchedAlias: hit?.alias ?? null,
      method: hit?.method ?? null,
      rule,
      merchantId: hit?.m.id ?? rule?.result.merchantId ?? null,
      displayName: hit?.m.displayName ?? rule?.result.displayName ?? null,
      category: hit?.m.category ?? rule?.result.category ?? null,
      confidence: hit ? hit.m.defaultConfidence : rule?.confidence ?? null,
      tags,
      stages: { rawnorm, light, full, prefixRemainder: remainder },
      negativeSkips: skips,
    };
  }
}
