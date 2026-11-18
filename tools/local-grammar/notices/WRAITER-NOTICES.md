# Bundled local grammar checker

WRAITER includes LanguageTool 6.8 libraries and English and Swedish rule data,
distributed separately from WRAITER's own code under the GNU Lesser General
Public License, version 2.1 or later. Their license text is in
`LanguageTool-COPYING.txt`. The LanguageTool project is at
https://github.com/languagetool-org/languagetool. Corresponding source archives
for the LanguageTool libraries, language modules, English dictionary data and OpenRegex are in
the adjacent `sources` directory; the libraries are separate JAR files and can
be replaced. The English language JAR is repacked to omit an unused spelling
correction model; its code and rule data are otherwise unmodified. WRAITER's
small bridge and fallback chunker are supplied as Java source and a JAR.

The English checks use Apache OpenNLP 1.9.4 and the OpenNLP 1.5 tokenizer,
part-of-speech, and chunking models packaged by UW KnowItAll. The Apache 2.0
license and OpenNLP notice are included in `jars/opennlp-tools`; the individual
model coordinates and licenses are recorded in `maven-licenses-6.8.xml`.
OpenNLP source: https://github.com/apache/opennlp/tree/opennlp-1.9.4

`maven-licenses-6.8.xml` records dependency license declarations from Maven.
`README.txt` and the other texts in this directory are LanguageTool's own
third-party notices. The `jars` subdirectory retains license and notice files
embedded in the individual libraries. The English dictionary's source and
attribution are also described in `pos-readme.txt` and `agid-readme.txt`.

The bundled Eclipse Temurin Java 21 runtime includes its own license and legal
notices in `runtime/legal`. It is an unmodified Eclipse Adoptium distribution;
its corresponding source and build information are available from
https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.13%2B9
and https://github.com/adoptium/temurin-build. The runtime is separate from
WRAITER and may be replaced with a compatible Java 21 runtime.

WRAITER also includes compiled Hunspell dictionaries from Chromium's
`hunspell_dictionaries` repository, revision
`cccf64a8acc951afe3f47fee023908e55699bc58`, used by Electron 44.3.0's Chromium
152. Individual dictionary attribution and license terms are in the `hunspell`
notices directory. Their corresponding dictionary source files, affix rules,
additions, and notices are supplied in `sources/chromium-hunspell-sources.zip`.
The dictionaries and their source remain under their respective upstream
licenses. Source repository: https://chromium.googlesource.com/chromium/deps/hunspell_dictionaries/
