'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  AnimatedPageContainer,
  AnimatedHeader,
  AnimatedSection,
  AnimatedContent
} from '@/components/ui/animated-page-container';

export default function AnimatedOrderDetailTest() {
  const [activeTab, setActiveTab] = useState('tab1');

  return (
    <AnimatedPageContainer>
      <AnimatedHeader className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Order #12345</h1>
          <p className="text-sm text-muted-foreground mt-1">Created on February 9, 2025</p>
        </div>
        <div>
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 border-green-200">
            Completed
          </span>
        </div>
      </AnimatedHeader>

      <AnimatedSection>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="tab1">Details</TabsTrigger>
            <TabsTrigger value="tab2">Components</TabsTrigger>
            <TabsTrigger value="tab3">Documents</TabsTrigger>
          </TabsList>
          
          <TabsContent value="tab1" className="space-y-4">
            <AnimatedContent>
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Order Dashboard</h2>
                <Button>Add Products</Button>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Order Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h3 className="font-medium mb-2">Customer Details</h3>
                      <p className="text-sm">
                        <span className="font-medium">Customer:</span> Qbutton
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Contact:</span> John Doe
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Email:</span> john@example.com
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Phone:</span> 555-1234
                      </p>
                    </div>
                    <div>
                      <h3 className="font-medium mb-2">Order Information</h3>
                      <p className="text-sm">
                        <span className="font-medium">Order Date:</span> February 9, 2025
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Delivery Date:</span> February 28, 2025
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Status:</span> Completed
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Reference:</span> REF-12345
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </AnimatedContent>
          </TabsContent>
          
          <TabsContent value="tab2" className="space-y-6">
            <AnimatedContent>
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Component Requirements</h2>
                <Button>Order Components</Button>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Components List</CardTitle>
                </CardHeader>
                <CardContent>
                  <p>Components would be listed here with animations.</p>
                </CardContent>
              </Card>
            </AnimatedContent>
          </TabsContent>
          
          <TabsContent value="tab3" className="space-y-4">
            <AnimatedContent>
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Attachments</h2>
                <Button>Add Attachment</Button>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Order Documents</CardTitle>
                </CardHeader>
                <CardContent>
                  <p>Documents would be listed here with animations.</p>
                </CardContent>
              </Card>
            </AnimatedContent>
          </TabsContent>
        </Tabs>
      </AnimatedSection>
    </AnimatedPageContainer>
  );
} 