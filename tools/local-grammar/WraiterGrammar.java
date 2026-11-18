import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.security.Permission;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.languagetool.JLanguageTool;
import org.languagetool.Languages;
import org.languagetool.rules.ITSIssueType;
import org.languagetool.rules.Rule;
import org.languagetool.rules.RuleMatch;

/** A bounded, stdio-only wrapper around the locally bundled LanguageTool rules. */
public final class WraiterGrammar {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final Map<String, JLanguageTool> CHECKERS = new LinkedHashMap<>(4, 0.75f, true);
  private static final Set<String> DISABLED = Set.of("EN_A_VS_AN", "ENGLISH_WORD_REPEAT_RULE", "RB_RB_COMMA", "UPPERCASE_SENTENCE_START",
      "DOES_X_HAS", "WHERE_MD_VB", "CONDITIONAL_CLAUSE", "ADVERB_VERB_ADVERB_REPETITION", "THE_US", "WRONG_PRP_AT_SENT_START", "MISSING_ARTICLE",
      "STAIRS_COMPOUNDS", "ANY_BODY", "EN_SPECIFIC_CASE", "THIS_MISSING_VERB", "WORTH_WHILE", "SIGH_SIGN", "KIND_OF_A", "DOUBLE_NEGATIVE",
      "IT_IS_2", "NO_NOT", "A_INFINITIVE", "CONFUSION_OF_ME_I", "NEAR_BY", "IN_ON_THE_RIGHT_HAND_SIDE", "HEAD_COMPOUNDS", "BALL_COMPOUNDS",
      "PCT_SINGULAR_NOUN_PLURAL_VERB_AGREEMENT", "PRP_VBG", "HE_HIS", "DEPEND_ON", "MAN_COMPOUNDS", "NONE_THE_LESS",
      "INCORRECT_POSSESSIVE_FORM_AFTER_A_NUMBER", "RETURN_IN_THE", "DT_PRP", "SHORT_COMPARATIVES", "EMIGRATE_IMMIGRATE_CONFUSION",
      "THINK_YOU_A", "ADVERB_OR_HYPHENATED_ADJECTIVE", "IN_A_ISLAND", "TO_NON_BASE", "WOULD_BE_JJ_VB", "PAST_AN_PAST", "IS_AND_ARE",
      "THE_QUESTION_WH", "GAVE_GIVE", "FILL_OF_WITH", "CROSS_COMPOUNDS", "THAT_THAN", "NOW_A_DAYS_HYPHEN", "IF_WOULD_HAVE_VBN",
      "MISSING_TO_BETWEEN_BE_AND_VB", "PLEASE_BE_VB", "INTERESTED_BY");
  private static final Map<String, String> IRREGULAR_PARTICIPLES = Map.ofEntries(
      Map.entry("broke", "broken"), Map.entry("chose", "chosen"), Map.entry("drove", "driven"), Map.entry("ate", "eaten"),
      Map.entry("fell", "fallen"), Map.entry("froze", "frozen"), Map.entry("gave", "given"), Map.entry("saw", "seen"),
      Map.entry("spoke", "spoken"), Map.entry("stole", "stolen"), Map.entry("took", "taken"), Map.entry("tore", "torn"), Map.entry("wrote", "written"));
  // LanguageTool's Swedish rules do not classify their issue type. Keep a
  // small grammar-only allowlist instead of turning style rules on by default.
  private static final Set<String> SWEDISH_GRAMMAR = Set.of("JJ.OCH_n-ord.NN", "JJ.OCH_t-ord.NN", "ART_VB.n-ord", "ART_VB_NN.n-ord", "ART_VB.t-ord", "ART_VB_NN.t-ord", "EJ_FORE_ATT");

  // The process cannot open sockets, including loopback sockets. Only its
  // parent process can supply text, over stdin; no service port is opened.
  @SuppressWarnings("removal")
  private static void disableNetwork() {
    System.setSecurityManager(new SecurityManager() {
      @Override public void checkPermission(Permission permission) {
        if (permission instanceof java.net.SocketPermission) throw new SecurityException("Network access is disabled.");
      }
      @Override public void checkConnect(String host, int port) { throw new SecurityException("Network access is disabled."); }
      @Override public void checkConnect(String host, int port, Object context) { throw new SecurityException("Network access is disabled."); }
      @Override public void checkListen(int port) { throw new SecurityException("Network access is disabled."); }
      @Override public void checkAccept(String host, int port) { throw new SecurityException("Network access is disabled."); }
      @Override public void checkMulticast(java.net.InetAddress address) { throw new SecurityException("Network access is disabled."); }
    });
  }

  private static String dialect(String language) {
    String normalized = language.toLowerCase(java.util.Locale.ROOT);
    if (normalized.equals("sv") || normalized.startsWith("sv-")) return "sv";
    if (normalized.startsWith("en-gb") || normalized.startsWith("en-ie")) return "en-GB";
    if (normalized.startsWith("en-au")) return "en-AU";
    if (normalized.startsWith("en-ca")) return "en-CA";
    if (normalized.startsWith("en-za")) return "en-ZA";
    return "en-US";
  }

  private static boolean grammarRule(Rule rule, boolean swedish) {
    if (swedish) return !rule.isDictionaryBasedSpellingRule() && SWEDISH_GRAMMAR.contains(rule.getId());
    ITSIssueType kind = rule.getLocQualityIssueType();
    return !rule.isDictionaryBasedSpellingRule() && !DISABLED.contains(rule.getId()) && !rule.getId().startsWith("EN_COMPOUNDS_") && !rule.getId().startsWith("EN_MULTITOKEN_SPELLING") &&
        (kind == ITSIssueType.Grammar || kind == ITSIssueType.Misspelling || kind == ITSIssueType.Typographical);
  }

  private static JLanguageTool checker(String language) throws Exception {
    String key = dialect(language);
    JLanguageTool checker = CHECKERS.get(key);
    if (checker == null) {
      var selectedLanguage = Languages.getLanguageForShortCode(key);
      // The pinned OpenNLP resources run locally. Keep the dictionary-based
      // chunker as a fallback if an installed resource is missing or damaged.
      if (!key.equals("sv")) {
        try { selectedLanguage.getChunker(); }
        catch (RuntimeException | LinkageError unavailable) { selectedLanguage.setChunker(new RuleChunker()); }
      }
      checker = new JLanguageTool(selectedLanguage);
      for (Rule rule : new ArrayList<>(checker.getAllActiveRules())) if (!grammarRule(rule, key.equals("sv"))) checker.disableRule(rule.getId());
      CHECKERS.put(key, checker);
      if (CHECKERS.size() > 2) CHECKERS.remove(CHECKERS.keySet().iterator().next());
    }
    return checker;
  }

  // Decorative symbols before a sentence can prevent sentence-start rules
  // from matching. Replace only leading symbols with equal-length spaces for
  // analysis. The original text is retained and any overlapping match is
  // discarded below, so a suggestion cannot remove or rewrite an emoji.
  private static String maskLeadingSymbols(String text) {
    StringBuilder masked = new StringBuilder(text.length());
    boolean leading = true;
    for (int offset = 0; offset < text.length();) {
      int cp = text.codePointAt(offset), width = Character.charCount(cp), type = Character.getType(cp);
      if (leading && (type == Character.OTHER_SYMBOL || type == Character.MODIFIER_SYMBOL || cp == 0xFE0F || cp == 0x200D)) {
        for (int index = 0; index < width; index++) masked.append(' ');
      } else {
        masked.appendCodePoint(cp);
        if (cp == '.' || cp == '!' || cp == '?') leading = true;
        else if (leading && !Character.isWhitespace(cp) && "\"'“”‘’([{)]}".indexOf(cp) < 0) leading = false;
      }
      offset += width;
    }
    return masked.toString();
  }

  private static ArrayNode analyze(JLanguageTool checker, String text, boolean swedish) throws Exception {
    ArrayNode results = JSON.createArrayNode();
    String analyzed = maskLeadingSymbols(text);
    for (RuleMatch match : checker.check(analyzed)) {
      if (!grammarRule(match.getRule(), swedish)) continue;
      int from = match.getFromPos(), to = match.getToPos();
      if (from < 0 || to < from || to > text.length()) continue;
      String id = match.getRule().getId();
      if (id.equals("HE_VERB_AGR") && text.substring(Math.max(0, from - 60), from).matches("(?is).*\\b(?:if|whether|lest|though|suppose|wish)\\s+(?:he|she|it)\\s+$")) continue;
      if (id.equals("THERE_S_MANY") && (text.substring(to).startsWith("'s") || text.substring(to).startsWith("’s"))) continue;
      String matched = text.substring(from, to).toLowerCase(java.util.Locale.ROOT);
      String prior = text.substring(Math.max(0, from - 150), from);
      String following = text.substring(to);
      if (id.equals("HE_VERB_AGR") && prior.matches("(?is).*\\b(?:can|could|would|should|may|might|must|did|does)\\s+(?:not\\s+)?(?:he|she|it)\\s*$")) continue;
      if (id.equals("HE_VERB_AGR") && matched.endsWith("ing") && prior.matches("(?is).*\\b(?:said|replied|answered)\\s+(?:he|she)\\s*$")) continue;
      if (id.equals("IT_VBZ") && prior.matches("(?is).*\\bif\\s+it\\s*$") && matched.equals("be")) continue;
      if (id.equals("IT_VBZ") && prior.matches("(?is).*\\b(?:believing|thinking|knowing|finding|considering|supposing|proving|showing)\\s+it\\s*$")) continue;
      if (id.equals("ASK_TO") && following.matches("(?is)^\\s+(?:what|who|whom|where|how|which)\\b.*")) continue;
      if (id.equals("WERE_VBB") && following.matches("(?is)^\\s+(?:i|he|she|we|they|you)\\b.*")) continue;
      if (id.equals("PRP_PAST_PART") && prior.matches("(?is).*\\bhad\\s+not\\s+it\\s*$")) continue;
      if (id.equals("IN_WHO") && following.matches("(?s)^\\s*,.*")) continue;
      if (id.equals("YOUR") && following.matches("(?is)^\\s+[a-z]+ing\\b.*")) continue;
      if (id.equals("HAVE_PART_AGREEMENT") && prior.matches("(?is).*\\bhad\\s+rather\\s*$")) continue;
      if (id.equals("PRP_JJ") && prior.matches("(?is).*\\b(?:is|was|are|were)\\s+not\\s*$")) continue;
      if (id.equals("PRP_RB_JJ") && matched.equals("it") && prior.matches("(?is).*\\b(?:about|after|before|for|of|with)\\s*$")) continue;
      if (id.equals("ON_IN_THE_AFTERNOON") && following.matches("(?is)^\\s+(?:before|after|when)\\b.*")) continue;
      if (id.equals("CONFUSION_WORSE_WORST") && following.matches("(?is)^\\s+of\\b.*")) continue;
      if (id.equals("CONFUSION_WORSE_WORST") && following.matches("(?is)^\\s+for\\b.*")) continue;
      if (id.equals("OTHER_OTHERS") && prior.matches("(?is).*\\bsomehow\\s+or\\s*$")) continue;
      if (id.equals("AT_IN_THE_KITCHEN") && following.matches("(?is)^\\s+(?:door|gate|window|entrance|steps)\\b.*")) continue;
      if (id.equals("THE_SUPERLATIVE") && matched.equals("least") && following.matches("(?is)^\\s+danger\\b.*")) continue;
      if (id.equals("TO_TOO") && prior.matches("(?is).*\\bequal\\s*,?\\s*(?:however\\s*,?\\s*)?$") && following.matches("(?is)^\\s+much\\b.*")) continue;
      if (id.equals("ADMIT_ENJOY_VB") && matched.equals("suggest to be") && following.matches("(?is)^\\s+(?:advisable|necessary|appropriate|possible)\\b.*")) continue;
      if (id.equals("ALLOW_TO") && matched.equals("to effect") && prior.matches("(?is).*\\bcause\\s*$")) continue;
      if (id.equals("COLLECTIVE_NOUN_VERB_AGREEMENT_VBP") && prior.matches("(?is).*\\b(?:these|those)\\s+(?:sort|kind)\\s+of\\s+[^.!?]*$")) continue;
      if (id.equals("A_BIT_OF") && prior.matches("(?is).*\\bnot\\s+a\\s*$")) continue;
      if (id.equals("IT_VBZ") && matched.equals("please") && prior.matches("(?is).*\\bif\\s+it\\s*$")) continue;
      if (id.equals("I_AFRAID") && following.matches("(?is)^\\s+to\\b.*")) continue;
      if (id.equals("ADVISE_VBG") && prior.matches("(?is).*\\bhelp\\s*$")) continue;
      if (id.equals("NON3PRS_VERB") && matched.equals("needs") && prior.matches("(?is).*\\bmust\\s*$")) continue;
      if (id.equals("NON3PRS_VERB") && matched.equals("thieves") && prior.matches("(?is).*\\byou\\s*$")) continue;
      if (id.equals("BY_BUY") && matched.equals("by") && prior.matches("(?is).*\\byou\\s*$") && following.matches("(?is)^\\s+the\\b.*")) continue;
      if (id.equals("BY_BUY") && matched.equals("by") && (prior.matches("(?is).*\\bend\\s+to\\s*$") || following.matches("(?is)^\\s+this\\s+time\\b.*"))) continue;
      if (id.equals("THE_SUPERLATIVE") && matched.equals("a") && following.matches("(?is)^\\s+best\\s+man\\b.*")) continue;
      if (id.equals("A_LOT_OF_NN") && matched.matches("(?s).*\\b(?:hundred|thousand|million|billion)\\b.*")) continue;
      if (id.equals("CD_NN") && Set.of("pound", "mile", "foot", "stone", "ton", "dollar", "euro").contains(matched)) continue;
      if (id.equals("VULNERABLE_FROM_TO") && following.matches("(?is)^\\s+(?:above|below|behind|outside|inside)\\b.*")) continue;
      if (id.equals("PRP_HAVE_VB") && matched.equals("occasion")) continue;
      if (id.equals("MISSING_TO_BEFORE_A_VERB") && matched.matches("(?is)^need\\s+.*")) continue;
      // A number of words can be either nouns or verbs. The deterministic
      // chunker deliberately avoids guessing their role in these contexts.
      if (id.equals("MISSING_TO_BEFORE_A_VERB") && !matched.matches("(?is)^(?:want|wants|wanted|like|likes|liked)\\s+(?:arrive|come|eat|go|leave|return|run|see|sleep|speak|stay|swim|walk|write)$")) continue;
      if (id.equals("ITS_TO_IT_S") && following.matches("(?is)^\\s+(?:(?:frequently|often|sometimes|constantly|continually|suddenly)\\s+)?[a-z]+ing\\b.*")) continue; // Possessive gerunds.
      if (id.equals("ITS_TO_IT_S") && !following.matches("(?is)^\\s+(?:not|a|an|the|been|got)\\b.*")) continue;
      if (id.equals("FOR_VB") && Set.of("for fear", "for want", "for people", "for good", "for sure").contains(matched)) continue;
      if (id.equals("MUCH_COUNTABLE") && following.matches("(?is)^\\s+like\\b.*")) continue;
      if (id.equals("THERE_RE_MANY") && Set.of("in", "on", "at", "of", "to", "for", "by", "up").contains(matched)) continue;
      if (id.equals("ALLOW_TO_DO") && matched.equals("merit")) continue;
      if (id.equals("MANY_NN") && following.matches("(?s)^\\s*[,;:].*")) continue;
      if (id.equals("PERS_PRONOUN_AGREEMENT") && matched.equals("were") && prior.matches("(?is).*\\b(?:if|whether|though|lest)\\s+(?:i|he|she|it)\\s*$")) continue;
      if (id.equals("IN_A_TROUBLE") && following.matches("(?is)^\\s+(?:which|that)\\b.*")) continue;
      if (id.equals("IT_TIME_TO") && prior.matches("(?is).*\\b(?:thought|think|thinks|consider|considered|find|found|deem|deemed|feel|felt)\\s*$")) continue;
      if (id.equals("ADMIT_ENJOY_VB")) {
        if (matched.matches("(?s).*\\b(?:used|accustomed)\\s+to\\b.*")) continue; // Infinitives can be correct in these contexts.
        if (prior.matches("(?is).*\\b(?:want|wants|wanted|expect|expects|expected|need|needs|needed)\\b[^.!?]*\\band\\s*$")) continue;
      }
      // A sum, distance, or duration can be treated as a single quantity.
      if (id.equals("THERE_S_MANY") && matched.matches("(?s).*\\b(?:dollars|euros|pounds|miles|kilometres|kilometers|metres|meters|feet|yards|seconds|minutes|hours|days|weeks|months|years|percent)\\b.*")) continue;
      if (id.equals("BE_PART_AGREEMENT_2") && matched.equals("mistakes")) continue; // Also a plural noun.
      if (id.equals("HAVE_PART_AGREEMENT") && matched.equals("visa")) continue; // Also an ordinary noun.
      if (id.equals("ALL_NN") && Set.of("mm", "cm", "km", "mg", "kg", "ml", "km/h", "mph").contains(matched)) continue;
      if (id.equals("DO_HE_VERB") && text.substring(Math.max(0, from - 60), from).matches("(?is).*\\byou\\s*,\\s*like\\s*,\\s*$")) continue;
      List<String> suggestions = match.getSuggestedReplacements();
      if (id.equals("BEEN_PART_AGREEMENT") && IRREGULAR_PARTICIPLES.containsKey(matched)) {
        String corrected = IRREGULAR_PARTICIPLES.get(matched);
        if (!text.substring(from, to).isEmpty() && Character.isUpperCase(text.charAt(from))) corrected = Character.toUpperCase(corrected.charAt(0)) + corrected.substring(1);
        suggestions = List.of(corrected);
      }
      if (suggestions.isEmpty()) continue;
      boolean insertion = from == to;
      boolean insertBefore = false;
      if (insertion) {
        if (from > 0) from = text.offsetByCodePoints(from, -1);
        else if (to < text.length()) { to = text.offsetByCodePoints(to, 1); insertBefore = true; }
        else continue;
      }
      String original = text.substring(from, to);
      if (!analyzed.regionMatches(from, text, from, to - from) || original.indexOf('\ufffc') >= 0 || original.indexOf('\n') >= 0 || original.indexOf('\r') >= 0) continue;
      ArrayNode alternatives = JSON.createArrayNode();
      Set<String> seen = new HashSet<>();
      for (String replacement : suggestions) {
        if (replacement == null || replacement.length() > 1000 || replacement.indexOf('\n') >= 0 || replacement.indexOf('\r') >= 0 || replacement.indexOf('\0') >= 0 || replacement.indexOf('\ufffc') >= 0) continue;
        if (insertion) replacement = insertBefore ? replacement + original : original + replacement;
        if (replacement.equals(original) || !seen.add(replacement)) continue;
        alternatives.add(replacement);
        if (alternatives.size() == 5) break;
      }
      if (alternatives.isEmpty()) continue;
      ObjectNode item = results.addObject();
      item.put("from", from); item.put("to", to); item.put("original", original);
      item.put("replacement", alternatives.get(0).asText()); item.set("alternatives", alternatives);
      item.put("reason", match.getMessage().replaceAll("<[^>]*>", "").replace('\n', ' ').replace('\r', ' '));
      item.put("category", "grammar"); item.put("rule", "lt:" + match.getRule().getId());
    }
    return results;
  }

  public static void main(String[] args) throws Exception {
    disableNetwork();
    if (args.length == 1 && "--network-self-test".equals(args[0])) {
      try (java.net.Socket socket = new java.net.Socket()) {
        socket.connect(new java.net.InetSocketAddress("127.0.0.1", 7), 100);
        throw new IllegalStateException("A socket was permitted.");
      } catch (SecurityException expected) {
        // Exercise multicast and explicit socket permission checks without
        // sending a packet or resolving a remote host.
        try {
          System.getSecurityManager().checkMulticast(java.net.InetAddress.getByAddress(new byte[] {(byte) 224, 0, 0, 1}));
          throw new IllegalStateException("Multicast was permitted.");
        } catch (SecurityException blocked) { /* Expected. */ }
        try {
          System.getSecurityManager().checkPermission(new java.net.SocketPermission("127.0.0.1:7", "connect,resolve"));
          throw new IllegalStateException("Socket permissions were allowed.");
        } catch (SecurityException blocked) { /* Expected. */ }
        System.out.println("network-disabled"); return;
      }
    }
    // Windows may select a legacy console encoding for System.out even when
    // the parent process expects UTF-8 over a pipe. Never corrupt non-ASCII
    // text or offsets in JSON replies.
    PrintStream protocol = new PrintStream(System.out, true, StandardCharsets.UTF_8);
    System.setOut(new PrintStream(OutputStream.nullOutputStream(), true, StandardCharsets.UTF_8));
    try (BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
      for (String line; (line = input.readLine()) != null;) {
        ObjectNode response = JSON.createObjectNode();
        try {
          JsonNode request = JSON.readTree(line);
          response.put("id", request.path("id").asLong());
          String language = request.path("language").asText();
          JsonNode passages = request.path("texts");
          if (!language.toLowerCase(java.util.Locale.ROOT).matches("(?:en|sv)(?:-.*)?") || !passages.isArray() || passages.size() > 16) throw new IllegalArgumentException("Unsupported grammar request.");
          int total = 0;
          for (JsonNode passage : passages) { if (!passage.isTextual() || passage.textValue().length() > 3500) throw new IllegalArgumentException("Passage is too long."); total += passage.textValue().length(); }
          if (total > 12000) throw new IllegalArgumentException("Grammar request is too long.");
          JLanguageTool checker = checker(language);
          ArrayNode results = response.putArray("results");
          for (JsonNode passage : passages) results.add(analyze(checker, passage.textValue(), dialect(language).equals("sv")));
        } catch (Exception error) {
          response.put("error", error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage()));
        }
        protocol.println(JSON.writeValueAsString(response));
      }
    }
  }
}
