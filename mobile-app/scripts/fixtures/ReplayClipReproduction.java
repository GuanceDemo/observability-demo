import com.ft.sdk.sessionreplay.internal.processor.NodeFlattener;
import com.ft.sdk.sessionreplay.internal.recorder.Node;
import com.ft.sdk.sessionreplay.model.ShapeStyle;
import com.ft.sdk.sessionreplay.model.ShapeWireframe;
import com.ft.sdk.sessionreplay.model.Wireframe;
import java.util.List;

public class ReplayClipReproduction {
  static ShapeWireframe shape(long id, long x, long y, long w, long h, String color) {
    return new ShapeWireframe(id, x, y, w, h, null, new ShapeStyle(color, 1f, 0f), null);
  }

  static List<Wireframe> flatten(boolean mappedScrollViewport, boolean horizontal, boolean transparent) {
    ShapeWireframe root = shape(1, 0, 0, 390, 844, "#ffffffff");
    ShapeWireframe header = shape(2, 0, 0, horizontal ? 120 : 390, horizontal ? 844 : 140, "#ffffffff");
    ShapeWireframe logo = shape(3, 20, 30, 30, 30, "#ff3558ff");
    ShapeWireframe viewport = new ShapeWireframe(4, horizontal ? 120 : 0, horizontal ? 0 : 140, horizontal ? 270 : 390, horizontal ? 844 : 620, null, transparent ? null : new ShapeStyle("#f7f7f6ff", 1f, 0f), null);
    ShapeWireframe scrollingCard = shape(5, horizontal ? -100 : 10, horizontal ? 10 : -100, horizontal ? 340 : 185, horizontal ? 185 : 340, "#ffffffff");
    List<Wireframe> rootParents = List.of(root);
    List<Wireframe> cardParents = mappedScrollViewport ? List.of(root, viewport) : rootParents;
    Node headerNode = new Node(List.of(header), List.of(), rootParents);
    Node logoNode = new Node(List.of(logo), List.of(), rootParents);
    Node cardNode = new Node(List.of(scrollingCard), List.of(), cardParents);
    Node scrollNode = new Node(mappedScrollViewport ? List.of(viewport) : List.of(), List.of(cardNode), rootParents);
    return new NodeFlattener().flattenNode(new Node(List.of(root), List.of(headerNode, logoNode, scrollNode), List.of()));
  }

  static void verify(boolean horizontal, boolean transparent) {
    List<Wireframe> missing = flatten(false, horizontal, transparent);
    List<Wireframe> present = flatten(true, horizontal, transparent);
    ShapeWireframe missingCard = (ShapeWireframe) missing.stream().filter(w -> w.getId() == 5).findFirst().orElseThrow();
    ShapeWireframe presentCard = (ShapeWireframe) present.stream().filter(w -> w.getId() == 5).findFirst().orElseThrow();
    long missingTop = horizontal ? missingCard.getX() + missingCard.getClip().getLeft() : missingCard.getY() + missingCard.getClip().getTop();
    long presentTop = horizontal ? presentCard.getX() + presentCard.getClip().getLeft() : presentCard.getY() + presentCard.getClip().getTop();
    boolean missingLogo = missing.stream().noneMatch(w -> w.getId() == 3);
    boolean presentLogo = present.stream().anyMatch(w -> w.getId() == 3);
    if (missingTop != 0 || presentTop != (horizontal ? 120 : 140) || !missingLogo || !presentLogo) {
      throw new AssertionError("SDK behavior did not match the clipping hypothesis");
    }
    System.out.println("PASS: official SDK viewport clipping, horizontal=" + horizontal + ", transparent=" + transparent);
  }

  public static void main(String[] args) {
    verify(false, false);
    verify(false, true);
    verify(true, false);
    verify(true, true);
  }
}
