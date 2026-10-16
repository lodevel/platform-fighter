// Versioned offline artist raster. Does not implement native game shaders.
// Float64 barycentrics, source-order triangles, Repeat UV, depth and eye rules
// follow link_native_uv_raster.py. No fast-math or fused multiply/add.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

extern "C" void link_author_raster_v2(
 const double* vertices, int vertexCount, const int64_t* indices, int indexCount,
 const double* uvs, const uint8_t* texture, int textureWidth, int textureHeight,
 uint8_t* pixels, double* depth, uint16_t* regions, uint16_t region,
 const uint8_t* eye, int eyeWidth, int eyeHeight, const double* transform,
 double rootX, double rootY, double ppu, double viewSign, int width, int height,
 float* uvBuffer, uint16_t* textureRegions, uint16_t textureId) {
 std::vector<double> screen(vertexCount*2);
 for(int n=0;n<vertexCount;++n) {
  screen[2*n]=rootX+vertices[3*n+2]*ppu;
  screen[2*n+1]=rootY-vertices[3*n+1]*ppu;
 }
 auto repeat=[](double v,int size) {return std::min(size-1,static_cast<int>(std::floor((v-std::floor(v))*size)));};
 for(int k=0;k+2<indexCount;k+=3) {
  const int64_t a=indices[k], b=indices[k+1], c=indices[k+2];
  const double ax=screen[2*a],ay=screen[2*a+1],bx=screen[2*b],by=screen[2*b+1],cx=screen[2*c],cy=screen[2*c+1];
  const int x0=std::max(0,static_cast<int>(std::floor(std::min({ax,bx,cx}))));
  const int y0=std::max(0,static_cast<int>(std::floor(std::min({ay,by,cy}))));
  const int x1=std::min(width-1,static_cast<int>(std::ceil(std::max({ax,bx,cx}))));
  const int y1=std::min(height-1,static_cast<int>(std::ceil(std::max({ay,by,cy}))));
  const double den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
  if(x0>x1||y0>y1||std::abs(den)<1e-8)continue;
  for(int y=y0;y<=y1;++y)for(int x=x0;x<=x1;++x) {
   const double xx=x+.5,yy=y+.5;
   const double w0=((by-cy)*(xx-cx)+(cx-bx)*(yy-cy))/den;
   const double w1=((cy-ay)*(xx-cx)+(ax-cx)*(yy-cy))/den;
   const double w2=1-w0-w1;
   if(w0<-1e-6||w1<-1e-6||w2<-1e-6)continue;
   const double z=((w0*vertices[3*a]+w1*vertices[3*b])+w2*vertices[3*c])*viewSign;
   const int pixel=y*width+x;
   if(!(z<depth[pixel]))continue;
   const double u=(w0*uvs[2*a]+w1*uvs[2*b])+w2*uvs[2*c];
   const double v=(w0*uvs[2*a+1]+w1*uvs[2*b+1])+w2*uvs[2*c+1];
   const uint8_t* color=texture+4*(repeat(v,textureHeight)*textureWidth+repeat(u,textureWidth));
   if(color[3]<=127)continue;
   uint8_t* result=pixels+4*pixel;
   if(eye) {
    const double pu=transform[0]*(u-transform[2]),pv=1-transform[1]*(1-v-transform[3]);
    const uint8_t* decal=eye+4*(repeat(pv,eyeHeight)*eyeWidth+repeat(pu,eyeWidth));
    const double alpha=decal[3]/255.;
    for(int channel=0;channel<3;++channel)result[channel]=static_cast<uint8_t>(std::nearbyint(color[channel]*(1-alpha)+decal[channel]*alpha));
   } else for(int channel=0;channel<3;++channel)result[channel]=color[channel];
   result[3]=color[3];depth[pixel]=z;regions[pixel]=region;
   if(uvBuffer) {uvBuffer[2*pixel]=static_cast<float>(u);uvBuffer[2*pixel+1]=static_cast<float>(v);textureRegions[pixel]=textureId;}
  }
 }
}
