# JavaCPP resolves classes and annotations reflectively.
-keep class org.bytedeco.** { *; }
-keep class org.wamr.** { *; }
-keep class org.nativescript.wamr.** { *; }
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,InnerClasses,EnclosingMethod
-dontwarn java.awt.**
