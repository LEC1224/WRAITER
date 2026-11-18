import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.languagetool.AnalyzedTokenReadings;
import org.languagetool.chunking.Chunker;
import org.languagetool.chunking.ChunkTag;

/** Conservative noun and verb phrase tags derived from dictionary readings.
 * This class uses no trained model and applies bounded heuristics where
 * words have multiple dictionary readings.
 */
public final class RuleChunker implements Chunker {
  private static final Set<String> PLURAL_PRONOUNS = Set.of("we", "us", "they", "them", "these", "those");
  private static boolean pos(AnalyzedTokenReadings t, String p) { return t.hasPosTag(p); }
  private static boolean noun(AnalyzedTokenReadings t) { return t.hasPosTagStartingWith("NN"); }
  private static boolean verb(AnalyzedTokenReadings t) { return t.hasPosTagStartingWith("VB") || pos(t,"MD"); }
  private static boolean adjective(AnalyzedTokenReadings t) { return t.hasPosTagStartingWith("JJ"); }
  private static boolean determiner(AnalyzedTokenReadings t) { return pos(t,"DT") || pos(t,"PDT") || pos(t,"PRP$") || pos(t,"WDT"); }
  private static boolean pronoun(AnalyzedTokenReadings t) { return pos(t,"PRP") || pos(t,"EX"); }
  private static void set(AnalyzedTokenReadings t,String... tags) {
    List<ChunkTag> list = new ArrayList<>();
    for(String tag:tags)list.add(new ChunkTag(tag));
    t.setChunkTags(list);
  }
  private static void phrase(List<AnalyzedTokenReadings> words,int from,int to,boolean plural) {
    String type="NP-"+(plural?"plural":"singular");
    for(int i=from;i<=to;i++){
      if(from==to)set(words.get(i),"B-"+type,"E-"+type);
      else if(i==from)set(words.get(i),"B-"+type);
      else if(i==to)set(words.get(i),"E-"+type);
      else set(words.get(i),"I-"+type);
    }
  }
  @Override public void addChunkTags(List<AnalyzedTokenReadings> readings) {
    List<AnalyzedTokenReadings> words=new ArrayList<>();
    for(var t:readings){
      String text=t.getToken();
      if(text==null || text.isBlank())continue;
      words.add(t);set(t,"O");
    }
    boolean[] used=new boolean[words.size()];
    for(int i=0;i<words.size();i++){
      var t=words.get(i);
      if(pronoun(t) && !determiner(t)){
        phrase(words,i,i,PLURAL_PRONOUNS.contains(t.getToken().toLowerCase(Locale.ROOT)));used[i]=true;continue;
      }
      if(determiner(t)){
        int head=-1;
        for(int j=i+1;j<words.size() && j<=i+6;j++){
          var x=words.get(j);
          if(determiner(x) || pronoun(x) || pos(x,"IN") && !adjective(x) && !noun(x))break;
          if(adjective(x) && j+1<words.size() && (noun(words.get(j+1)) || adjective(words.get(j+1))))continue;
          if(noun(x)){
            head=j;
            if(j+1>=words.size() || !noun(words.get(j+1)) || verb(words.get(j+1)))break;
            continue;
          }
          if(!pos(x,"CD") && !adjective(x))break;
        }
        if(head>=0){
          boolean plural=pos(words.get(head),"NNS") && !pos(words.get(head),"NN");
          phrase(words,i,head,plural);
          for(int j=i;j<=head;j++)used[j]=true;
          i=head;
        }
      } else if(noun(t) && !verb(t) && !adjective(t)){
        phrase(words,i,i,pos(t,"NNS") && !pos(t,"NN"));used[i]=true;
      }
    }
    boolean inVerb=false;
    for(int i=0;i<words.size();i++){
      var t=words.get(i);
      if(used[i]){inVerb=false;continue;}
      if(verb(t) || inVerb && pos(t,"TO")){
        set(t,inVerb?"I-VP":"B-VP");inVerb=true;
      } else {
        inVerb=false;
        if(pos(t,"IN") || pos(t,"TO"))set(t,"B-PP");
        else if(t.hasPosTagStartingWith("RB"))set(t,"B-ADVP");
        else if(adjective(t))set(t,"B-ADJP");
      }
    }
  }
}
