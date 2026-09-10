import com.ft.sdk.reactnative.sessionreplay.utils.ReactViewBackgroundDrawableUtils.BorderSnapshot;
public class ReplayBorderContractCheck {
 static void check(boolean b) { if (!b) throw new AssertionError(); }
 public static void main(String[] args) {
 check(new BorderSnapshot(1,1,1,1,0xff123456,0xff123456,0xff123456,0xff123456).uniformBorder()!=null);
 check(new BorderSnapshot(0,0,0,1,1,1,1,1).uniformBorder()==null);
 check(new BorderSnapshot(.5f,.5f,.5f,.5f,1,1,1,1).uniformBorder()==null);
 check(new BorderSnapshot(1,1,1,1,1,2,1,1).uniformBorder()==null);
 check(new BorderSnapshot(Float.NaN,-1,Float.POSITIVE_INFINITY,0,1,1,1,1).uniformBorder()==null);
 System.out.println("PASS: uniform edge selection, single/fractional/mixed edge fallback and invalid widths");
 }
}