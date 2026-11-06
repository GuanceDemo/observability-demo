# HiveMQ Android guide: Netty and JCTools access fields reflectively.
-keepclassmembernames class io.netty.** { *; }
-keepclassmembers class org.jctools.** { *; }
# Netty TypeParameterMatcher reads the generic handler hierarchy at runtime.
# R8 full mode otherwise strips these signatures even when members are kept.
-keepattributes Signature,InnerClasses,EnclosingMethod
-keep,allowshrinking class io.netty.handler.codec.MessageToMessageEncoder
-keep,allowshrinking class io.netty.handler.codec.MessageToMessageDecoder
-keep,allowshrinking class io.netty.channel.SimpleChannelInboundHandler
-keep,allowshrinking class * extends io.netty.handler.codec.MessageToMessageEncoder
-keep,allowshrinking class * extends io.netty.handler.codec.MessageToMessageDecoder
-keep,allowshrinking class * extends io.netty.channel.SimpleChannelInboundHandler
# Android uses NIO and its platform TLS provider. These optional desktop
# transports/providers/logging backends are intentionally not packaged.
-dontwarn io.netty.channel.epoll.**
-dontwarn io.netty.handler.proxy.**
-dontwarn io.netty.internal.tcnative.**
-dontwarn org.eclipse.jetty.alpn.**
-dontwarn org.eclipse.jetty.npn.**
-dontwarn org.apache.log4j.**
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.apache.logging.log4j.**
-dontwarn org.slf4j.**
-dontwarn reactor.blockhound.**
