"""Small version-pinned aiortc adapter for negotiated sender playout guidance.

https://webrtc.googlesource.com/src/+/refs/heads/main/docs/native-code/rtp-hdrext/playout-delay/README.md
The zero min/max fields request earliest rendering; they are not a latency SLA.
"""
from importlib.metadata import version
from aiortc.codecs import HEADER_EXTENSIONS
from aiortc.rtcrtpparameters import RTCRtpHeaderExtensionParameters
from aiortc.rtp import HeaderExtensionsMap, pack_header_extensions, unpack_header_extensions

PLAYOUT_URI = 'http://www.webrtc.org/experiments/rtp-hdrext/playout-delay'


def install():
    if version('aiortc') != '1.14.0':
        raise RuntimeError('Revalidate playout adapter before changing aiortc version')
    if getattr(HeaderExtensionsMap, '_mall_playout_installed', False):
        return
    HEADER_EXTENSIONS['video'].append(RTCRtpHeaderExtensionParameters(id=4, uri=PLAYOUT_URI))
    original_configure = HeaderExtensionsMap.configure
    original_set = HeaderExtensionsMap.set

    def configure(self, parameters):
        original_configure(self, parameters)
        self._mall_playout_id = next((ext.id for ext in parameters.headerExtensions
                                     if ext.uri == PLAYOUT_URI), None)

    def serialize(self, values):
        profile, value = original_set(self, values)
        extension_id = getattr(self, '_mall_playout_id', None)
        if extension_id is not None:
            return pack_header_extensions(unpack_header_extensions(profile, value)
                                          + [(extension_id, bytes(3))])
        return profile, value

    HeaderExtensionsMap.configure = configure
    HeaderExtensionsMap.set = serialize
    HeaderExtensionsMap._mall_playout_installed = True
