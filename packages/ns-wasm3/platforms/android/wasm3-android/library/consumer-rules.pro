# JavaCPP resolves classes and annotations reflectively.
-keep class org.bytedeco.** { *; }
-keep class org.wasm3.** { *; }
-keep class org.nativescript.wasm3.** { *; }
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,InnerClasses,EnclosingMethod
-dontwarn java.awt.**
