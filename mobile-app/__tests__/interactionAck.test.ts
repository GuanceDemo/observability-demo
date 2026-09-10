import {
  acknowledgeInteraction,
  normalizeInteractionAction,
} from '../src/interactionAck';

describe('APK interaction acknowledgements', () => {
  it('normalizes action names into the bounded gateway contract', () => {
    expect(normalizeInteractionAction(' Open Book / 可观测性 ')).toBe(
      'open_book',
    );
    expect(normalizeInteractionAction(`x${'y'.repeat(100)}`)).toHaveLength(80);
  });

  it('calls the optional native bridge after a valid press action', () => {
    const acknowledgeInteractionNative = jest.fn();

    acknowledgeInteraction('Cart:Checkout', {
      acknowledgeInteraction: acknowledgeInteractionNative,
    });

    expect(acknowledgeInteractionNative).toHaveBeenCalledWith('cart:checkout');
  });

  it('ignores empty actions and unavailable native bridges', () => {
    const acknowledgeInteractionNative = jest.fn();

    acknowledgeInteraction('  中文  ', {
      acknowledgeInteraction: acknowledgeInteractionNative,
    });
    acknowledgeInteraction('open_book', undefined);

    expect(acknowledgeInteractionNative).not.toHaveBeenCalled();
  });
});
